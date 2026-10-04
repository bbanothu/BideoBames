"""Builds the game's hero character and demon sword in Blender and exports them as .glb.

Run headless:  blender -b --factory-startup --python blender/build_assets.py -- <repo>/sword
(on ARM Linux use blender/build.sh, which wraps Blender in muvm).

Conventions: the game is Y-up with characters facing +Z. Blender is Z-up; the glTF exporter
maps Blender (x, y, z) -> glTF (x, z, -y), so we author in "game coordinates" and convert with G().
The hero is exported as rigid pieces, one per joint of the game's rig, each with its origin at
the joint pivot. The game drives those pivots for animation and detaches them for dismemberment.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

ROOT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.getcwd()
MODELS = os.path.join(ROOT, "assets", "models")
BLEND_DIR = os.path.join(ROOT, "blender")
os.makedirs(MODELS, exist_ok=True)

# Game (x, y, z) -> Blender (x, -z, y)
M_G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def G(x, y, z):
    return Vector((x, -z, y))


def log(*a):
    print("[assets]", *a, flush=True)


# ── Scene helpers ────────────────────────────────────────────────────────────
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def material(name, color, metal=0.0, rough=0.5, emit=None, strength=1.0, coat=0.0, vcol=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.4
    if vcol:
        a = nt.nodes.new("ShaderNodeVertexColor")
        a.layer_name = vcol
        nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    return m


def mesh_from_bm(name, bm, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    obj = link(bpy.data.objects.new(name, me))
    if mat:
        me.materials.append(mat)
    return obj


def bake(obj, name=None, mat=None, smooth=None):
    """Replace obj (curve / metaball / modified mesh) with a plain mesh, modifiers applied."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    name = name or obj.name
    mw = obj.matrix_world.copy()
    mats = list(obj.data.materials) if hasattr(obj.data, "materials") else []
    bpy.data.objects.remove(obj, do_unlink=True)
    new = link(bpy.data.objects.new(name, me))
    new.matrix_world = mw
    if mat:
        me.materials.clear()
        me.materials.append(mat)
    elif not me.materials and mats:
        for m in mats:
            me.materials.append(m)
    if smooth is True:
        me.shade_smooth()
    elif smooth is False:
        me.shade_flat()
    return new


def place(obj, pos=(0, 0, 0), rot=(0, 0, 0)):
    """Position an object authored along Blender axes using a game-space transform."""
    tg = Matrix.Translation(Vector(pos)) @ Euler(rot, "XYZ").to_matrix().to_4x4()
    obj.matrix_world = M_G2B @ tg @ M_G2B.inverted() @ obj.matrix_world


def parent(child, par):
    child.parent = par
    child.matrix_parent_inverse = par.matrix_world.inverted()


def bm_cube(sx, sy, sz, at=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz)) + Vector(at)
    return bm


def bm_sphere(r, at=(0, 0, 0), scale=(1, 1, 1), u=16, v=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    for vt in bm.verts:
        vt.co = Vector((vt.co.x * scale[0], vt.co.y * scale[1], vt.co.z * scale[2])) + Vector(at)
    return bm


def bm_cyl(r1, r2, depth, at=(0, 0, 0), seg=12):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=depth)
    for v in bm.verts:
        v.co += Vector(at)
    return bm


def bm_torus(R, r, at=(0, 0, 0), seg=20, rseg=6, sx=1.0, sz=1.0):
    """Torus in Blender's XY plane (axis Z), optionally stretched into an ellipse."""
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = i / seg * math.tau
        ring = []
        for j in range(rseg):
            b = j / rseg * math.tau
            # Stretch only the ring path, not the tube, so ellipses keep an even thickness.
            ring.append(bm.verts.new((math.cos(a) * (R * sx + r * math.cos(b)), math.sin(a) * (R * sz + r * math.cos(b)), r * math.sin(b))))
        rings.append(ring)
    for i in range(seg):
        for j in range(rseg):
            a, b = rings[i], rings[(i + 1) % seg]
            bm.faces.new((a[j], b[j], b[(j + 1) % rseg], a[(j + 1) % rseg]))
    for v in bm.verts:
        v.co += Vector(at)
    return bm


def tube(name, pts, r0, mat, taper=0.08, res=4):
    """Tapered curve through game-space points (horns, claws, tendrils, veins)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r0
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        u = i / (len(pts) - 1)
        sp.points[i].co = (*G(*p), 1)
        sp.points[i].radius = 1 - u * (1 - taper)
    sp.use_endpoint_u = True
    sp.order_u = min(4, len(pts))
    sp.resolution_u = 10
    obj = link(bpy.data.objects.new(name, cu))
    cu.materials.append(mat)
    return bake(obj, name, smooth=True)


def metapart(name, balls, mat, res=0.011, k=1.75):
    """Organic mass from metaball ellipsoids. balls: (x, y, z, hx, hy, hz) in game space."""
    mb = bpy.data.metaballs.new(name + "MB")
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = 0.6
    obj = link(bpy.data.objects.new(name + "MB", mb))
    for x, y, z, hx, hy, hz in balls:
        e = mb.elements.new(type="ELLIPSOID")
        e.co = G(x, y, z)
        e.radius = 1.0
        e.stiffness = 2.0
        # game half-extents (hx, hy, hz) -> blender axes (x, -z, y)
        e.size_x, e.size_y, e.size_z = hx * k, hz * k, hy * k
    return bake(obj, name, mat=mat, smooth=True)


def sinew(obj, depth=0.0055, seed=0.0, scale=(16, 16, 4.5)):
    """Carve fibre grooves into the surface and paint them dark via vertex colours."""
    me = obj.data
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    sx, sy, sz = scale
    off = Vector((seed * 7.1, seed * 3.3, seed * 5.7))
    base = Vector((0.15, 0.13, 0.27))
    groove_c = Vector((0.03, 0.025, 0.06))
    hi = Vector((0.3, 0.27, 0.45))
    for v in me.vertices:
        p = v.co
        n = noise.noise(Vector((p.x * sx, p.y * sy, p.z * sz)) + off)
        n2 = noise.noise(Vector((p.x * 7, p.y * 7, p.z * 2)) + off * 2)
        groove = (1 - min(1, abs(n) * 3.2)) ** 3
        plate = max(0.0, n2) * 0.6
        v.co = p + v.normal * (depth * (plate - groove))
        c = base.lerp(hi, plate * 0.5).lerp(groove_c, groove)
        col.data[v.index].color = (c.x, c.y, c.z, 1)
    me.color_attributes.active_color = col
    me.update()


def decimate(obj, ratio):
    if ratio >= 1:
        return obj
    m = obj.modifiers.new("dec", "DECIMATE")
    m.ratio = ratio
    return bake(obj, obj.name)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export(path, blend_name):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BLEND_DIR, blend_name))
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_vertex_color="MATERIAL",
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )
    log("exported", path, os.path.getsize(path) // 1024, "KB")


# ── Hero ─────────────────────────────────────────────────────────────────────
def build_hero():
    reset()
    M = {
        "sinew": material("Sinew", (0.6, 0.55, 0.85), metal=0.2, rough=0.5, coat=0.35, vcol="Col"),
        "face": material("Faceplate", (0.04, 0.035, 0.06), metal=0.5, rough=0.25),
        "visor": material("Visor", (0.9, 0.9, 1.0), emit=(0.9, 0.9, 1.0), strength=3.0),
        "violet": material("Violet", (0.4, 0.15, 1.0), emit=(0.35, 0.1, 1.0), strength=2.0),
        "strap": material("Strap", (0.23, 0.15, 0.09), rough=0.7),
        "metal": material("Metal", (0.55, 0.53, 0.5), metal=0.8, rough=0.35),
        "sheath": material("Sheath", (0.07, 0.05, 0.11), metal=0.4, rough=0.35),
    }

    def muscle(name, balls, seed, ratio=0.55, res=0.011):
        o = metapart(name, balls, M["sinew"], res=res)
        sinew(o, seed=seed)
        o = decimate(o, ratio)
        log(name, "tris", tris(o), "dims", tuple(round(d, 3) for d in o.dimensions))
        return o

    parts = {}
    parts["hips"] = muscle("hips", [
        (0, 0, 0, 0.16, 0.11, 0.12),
        (0.075, -0.05, -0.06, 0.085, 0.09, 0.075),
        (-0.075, -0.05, -0.06, 0.085, 0.09, 0.075),
        (0, 0.03, 0.07, 0.12, 0.08, 0.06),
    ], 1)

    torso = [
        (0, 0.3, 0, 0.22, 0.21, 0.13),
        (0, 0.08, 0, 0.14, 0.13, 0.105),
        (0, 0.46, -0.03, 0.13, 0.06, 0.08),
        (0, 0.52, 0, 0.07, 0.06, 0.07),
    ]
    for sx in (-1, 1):
        torso += [
            (sx * 0.085, 0.37, 0.085, 0.1, 0.07, 0.055),
            (sx * 0.15, 0.24, -0.01, 0.07, 0.15, 0.09),
            (sx * 0.08, 0.3, -0.085, 0.09, 0.16, 0.055),
        ]
        torso += [(sx * 0.038, 0.06 + i * 0.058, 0.098, 0.034, 0.026, 0.024) for i in range(3)]
    t = parts["torso"] = muscle("torso", torso, 2, ratio=0.5)

    # Bandolier: a subdivided strip shrink-wrapped onto the chest and back.
    for nm, z, rz in (("strap_front", 0.2, 0.72), ("strap_back", -0.2, -0.72)):
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=2, y_segments=40, size=0.5)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.045, 0, v.co.y * 0.78))
        s = mesh_from_bm(nm, bm, M["strap"])
        place(s, (0, 0.27, z), (0, 0, rz))
        sw = s.modifiers.new("wrap", "SHRINKWRAP")
        sw.target = t
        sw.offset = 0.004
        so = s.modifiers.new("thick", "SOLIDIFY")
        so.thickness = 0.007
        s = bake(s, nm)
        parent(s, t)
    buckle = mesh_from_bm("buckle", bm_cube(0.05, 0.02, 0.04), M["metal"], smooth=False)
    place(buckle, (-0.075, 0.36, 0.15))
    parent(buckle, t)
    accent = mesh_from_bm("accent", bm_cube(0.018, 0.03, 0.26), M["violet"], smooth=False)
    place(accent, (0.2, 0.28, 0.06), (0, 0, 0.2))
    parent(accent, t)

    # Katana across the back, hilt over the right shoulder.
    kat = []
    kat.append(mesh_from_bm("scabbard", bm_cyl(0.022, 0.018, 0.78, (0, 0, -0.05)), M["sheath"]))
    for i in range(6):
        kat.append(mesh_from_bm(f"wrap{i}", bm_torus(0.023, 0.005, (0, 0, -0.38 + i * 0.13), seg=14, rseg=5), M["violet"]))
    kat.append(mesh_from_bm("tsuba", bm_cyl(0.045, 0.045, 0.012, (0, 0, 0.345), seg=16), M["metal"]))
    kat.append(mesh_from_bm("tsuka", bm_cyl(0.017, 0.017, 0.22, (0, 0, 0.46)), M["violet"]))
    kat.append(mesh_from_bm("kashira", bm_sphere(0.02, (0, 0, 0.575)), M["metal"]))
    for k in kat:
        place(k, (-0.02, 0.28, -0.17), (0.12, 0, 0.55))
        parent(k, t)

    # Head: sinew skull, dark faceplate, glowing visor slits, swept tendrils.
    h = parts["head"] = muscle("head", [
        (0, 0.04, 0, 0.068, 0.07, 0.068),
        (0, 0.16, -0.005, 0.1, 0.13, 0.115),
        (0, 0.27, -0.03, 0.05, 0.03, 0.09),
    ], 3, ratio=0.6, res=0.008)
    face = metapart("faceplate", [(0, 0.135, 0.05, 0.085, 0.1, 0.075), (0, 0.08, 0.06, 0.05, 0.04, 0.05)], M["face"], res=0.008)
    parent(face, h)
    for sx in (-1, 1):
        v = mesh_from_bm(f"visor{sx}", bm_cube(0.055, 0.012, 0.012), M["visor"], smooth=False)
        place(v, (sx * 0.034, 0.165, 0.118), (0, sx * 0.35, sx * -0.38))
        parent(v, h)
        tnd = tube(f"tendril{sx}", [(sx * 0.03, 0.24, -0.06), (sx * 0.05, 0.3, -0.1), (sx * 0.085, 0.335, -0.17), (sx * 0.1, 0.33, -0.21)], 0.009, M["sinew"])
        parent(tnd, h)

    for side, sx in (("L", 1), ("R", -1)):
        parts["upperarm_" + side] = muscle("upperarm_" + side, [
            (sx * 0.012, -0.02, 0, 0.09, 0.085, 0.095),
            (0, -0.15, 0, 0.055, 0.15, 0.055),
            (0, -0.14, 0.03, 0.06, 0.1, 0.058),
            (0, -0.13, -0.03, 0.058, 0.11, 0.055),
        ], 4 + sx)
        parts["forearm_" + side] = muscle("forearm_" + side, [
            (0, -0.08, 0.005, 0.06, 0.11, 0.058),
            (0, -0.18, 0, 0.045, 0.11, 0.045),
            (0, -0.27, 0, 0.04, 0.03, 0.04),
        ], 6 + sx)
        hand = parts["hand_" + side] = metapart("hand_" + side, [
            (0, -0.01, 0, 0.05, 0.055, 0.045),
            (0, -0.045, 0.025, 0.045, 0.022, 0.022),
            (sx * -0.035, -0.01, 0.03, 0.018, 0.035, 0.018),
        ], M["face"], res=0.008)
        parts["thigh_" + side] = muscle("thigh_" + side, [
            (0, -0.2, 0.01, 0.1, 0.22, 0.1),
            (sx * -0.035, -0.31, 0.04, 0.06, 0.1, 0.06),
            (sx * 0.04, -0.22, 0, 0.06, 0.15, 0.07),
            (0, -0.42, 0.03, 0.05, 0.05, 0.04),
        ], 8 + sx)
        shin = parts["shin_" + side] = muscle("shin_" + side, [
            (0, -0.21, 0, 0.052, 0.2, 0.052),
            (0, -0.13, -0.035, 0.065, 0.12, 0.062),
            (0, -0.4, 0, 0.045, 0.04, 0.045),
        ], 10 + sx)
        boot = mesh_from_bm("boot_" + side, bm_cube(0.12, 0.27, 0.08), M["face"], smooth=True)
        sub = boot.modifiers.new("sub", "SUBSURF")
        sub.levels = 2
        boot = bake(boot, "boot_" + side, smooth=True)
        place(boot, (0, -0.45, 0.05))
        parent(boot, shin)
        sole = mesh_from_bm("sole_" + side, bm_cube(0.125, 0.28, 0.02), M["sheath"], smooth=False)
        place(sole, (0, -0.485, 0.05))
        parent(sole, shin)

    export(os.path.join(MODELS, "hero.glb"), "hero.blend")


# ── Demon sword ──────────────────────────────────────────────────────────────
def build_sword():
    reset()
    M = {
        "bone": material("Bone", (0.82, 0.69, 0.55), rough=0.55),
        "dread": material("Dread", (0.16, 0.035, 0.045), metal=0.3, rough=0.45, emit=(0.05, 0.0, 0.005), strength=1.0),
        "glow": material("Glow", (0.7, 0.0, 0.0), rough=0.4, emit=(1.0, 0.0, 0.0), strength=2.2),
        "blood": material("BloodCloth", (0.4, 0.02, 0.04), rough=0.8),
    }
    L, Gd = 1.05, -0.1

    def Y(t):
        return Gd - t * L

    def width(t):
        return 0.07 + 0.055 * math.sin(min(t, 0.84) / 0.84 * math.pi * 0.8)

    def taper(t):
        return 1.0 if t < 0.84 else max(0.0, 1 - (t - 0.84) / 0.16)

    def side(sign, barbs):
        pts = []
        for i in range(51):
            t = i / 50
            w = width(t) * taper(t) * (1 if sign > 0 else 0.92)
            pts.append((sign * w, Y(t)))
            for bt, bl in barbs:
                if abs(bt - t) < 0.01:
                    pts.append((sign * (w + bl), Y(t - 0.05)))
                    pts.append((sign * w * 0.92, Y(t + 0.012)))
        return pts

    right = side(1, [(0.12, 0.05), (0.3, 0.04), (0.46, 0.06), (0.62, 0.045), (0.76, 0.05)])
    left = side(-1, [(0.06, 0.07), (0.22, 0.045), (0.4, 0.05), (0.56, 0.06), (0.7, 0.04), (0.84, 0.035)])
    outline = right + [(-0.015, Y(1.0))] + left[::-1]

    def slab(name, pts2d, thick, mat, bevel=0.0):
        bm = bmesh.new()
        vs = [bm.verts.new(G(x, y, 0)) for x, y in pts2d]
        bm.faces.new(vs)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        o = mesh_from_bm(name, bm, mat, smooth=False)
        so = o.modifiers.new("thick", "SOLIDIFY")
        so.thickness = thick
        so.offset = 0
        if bevel:
            bv = o.modifiers.new("bevel", "BEVEL")
            bv.width = bevel
            bv.segments = 2
            bv.limit_method = "ANGLE"
        return o

    def core_outline():
        pts = []
        for i in range(41):
            t = 0.02 + i / 40 * 0.86
            pts.append((width(t) * taper(t) * 0.68, Y(t)))
        pts.append((-0.01, Y(0.93)))
        for i in range(40, -1, -1):
            t = 0.02 + i / 40 * 0.86
            pts.append((-width(t) * taper(t) * 0.62, Y(t)))
        return pts

    holes = [(-0.035, 0.3, 0.026, 0.07, 0.25), (0.04, 0.5, 0.022, 0.06, -0.2), (-0.03, 0.68, 0.02, 0.05, 0.2)]
    cutters = []
    for i, (x, t, rx, ry, r) in enumerate(holes):
        c = mesh_from_bm(f"cut{i}", bm_cyl(1, 1, 0.2, seg=24), None, smooth=False)
        # cylinder axis along Blender Z -> rotate to thickness axis (Blender Y), then ellipse + tilt
        c.matrix_world = Matrix.Translation(G(x, Y(t), 0)) @ Matrix.Rotation(r, 4, "Y") @ Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Diagonal((rx, ry, 1, 1))
        cutters.append(c)

    blade = slab("blade_rim", outline, 0.014, M["bone"], bevel=0.003)
    core = slab("blade_core", core_outline(), 0.026, M["dread"])
    for o in (blade, core):
        for c in cutters:
            b = o.modifiers.new("hole", "BOOLEAN")
            b.operation = "DIFFERENCE"
            b.solver = "EXACT"
            b.object = c
    blade = bake(blade, "blade_rim", smooth=False)
    core = bake(core, "blade_core", smooth=False)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)

    # Glowing vein down the core and rims around each hole.
    vein_pts = []
    for i in range(16):
        t = 0.03 + i / 15 * 0.88
        x = math.sin(t * 9) * 0.012 + (math.sin((t - 0.25) * math.pi * 2) * 0.01 if 0.25 < t < 0.75 else 0)
        vein_pts.append((x, Y(t), 0))
    for zf in (0.013, -0.013):
        tube(f"vein{zf > 0}", [(x, y, zf) for x, y, _ in vein_pts], 0.0065, M["glow"], taper=0.3)
    for i, (x, t, rx, ry, r) in enumerate(holes):
        for zf in (0.013, -0.013):
            ring = mesh_from_bm(f"ring{i}", bm_torus(1, 0.0055, seg=28, rseg=6, sx=rx + 0.004, sz=ry + 0.004), M["glow"])
            ring.matrix_world = Matrix.Translation(G(x, Y(t), zf)) @ Matrix.Rotation(r, 4, "Y") @ Matrix.Rotation(math.pi / 2, 4, "X")

    # Guard: organic dark block, glowing eyes and gem, sweeping horns.
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.075)
    for v in bm.verts:
        v.co = Vector((v.co.x * 1.5, v.co.y * 0.55, v.co.z * 0.9))
        v.co += v.co.normalized() * 0.008 * noise.noise(v.co * 40)
        v.co += Vector(G(0, Gd - 0.01, 0))
    mesh_from_bm("guard", bm, M["dread"])
    for x in (-0.035, 0.035):
        for z in (0.04, -0.04):
            mesh_from_bm("eye", bm_sphere(0.014, G(x, Gd, z), u=10, v=8), M["glow"])
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=0, radius=0.022)
    for v in bm.verts:
        v.co += G(0, Gd - 0.045, 0)
    mesh_from_bm("gem", bm, M["glow"], smooth=False)
    horns = [
        ([(0.08, Gd, 0), (0.17, Gd + 0.04, 0), (0.2, Gd + 0.13, 0), (0.16, Gd + 0.2, 0)], 0.022, "bone"),
        ([(-0.08, Gd, 0), (-0.16, Gd + 0.03, 0), (-0.2, Gd + 0.11, 0), (-0.18, Gd + 0.19, 0)], 0.022, "bone"),
        ([(0.06, Gd - 0.03, 0), (0.13, Gd - 0.09, 0), (0.18, Gd - 0.06, 0)], 0.016, "dread"),
        ([(-0.06, Gd - 0.03, 0), (-0.14, Gd - 0.1, 0), (-0.2, Gd - 0.08, 0)], 0.016, "dread"),
        ([(0.03, Gd + 0.02, 0), (0.07, Gd + 0.09, 0), (0.11, Gd + 0.12, 0)], 0.014, "dread"),
        ([(-0.03, Gd + 0.02, 0), (-0.07, Gd + 0.09, 0), (-0.11, Gd + 0.12, 0)], 0.014, "dread"),
    ]
    for i, (pts, r, m) in enumerate(horns):
        tube(f"horn{i}", pts, r, M[m])

    # Grip: knuckled bone, blood-red wraps, hanging cloth strips; claw-held orb pommel.
    segs = 5
    for i in range(segs):
        y = Gd + 0.03 + i * 0.055
        mesh_from_bm(f"grip{i}", bm_cyl(0.021, 0.017, 0.05, G(0, y + 0.025, 0), seg=10), M["bone"])
        mesh_from_bm(f"knuckle{i}", bm_sphere(0.026, G(0, y, 0), scale=(1, 1, 0.6), u=12, v=8), M["bone"])
        if i % 2:
            w = mesh_from_bm(f"wrap{i}", bm_torus(0.022, 0.007, seg=14, rseg=5), M["blood"])
            w.matrix_world = Matrix.Translation(G(0, y + 0.025, 0)) @ Matrix.Rotation(0.3, 4, "X")
    top = Gd + 0.03 + segs * 0.055
    for i, (x, z, ln, rz) in enumerate(((0.02, 0.012, 0.16, 0.15), (0.005, -0.012, 0.12, -0.1), (-0.015, 0.01, 0.09, 0.3))):
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=2, y_segments=12, size=0.5)
        for v in bm.verts:
            u = v.co.y + 0.5
            v.co = Vector((v.co.x * 0.022 + math.sin(u * 7 + i) * 0.006, math.sin(u * 5 + i) * 0.006, -u * ln))
        s = mesh_from_bm(f"strip{i}", bm, M["blood"])
        so = s.modifiers.new("t", "SOLIDIFY")
        so.thickness = 0.003
        s = bake(s, f"strip{i}")
        place(s, (x, top - 0.06, z), (0, 0, rz))
    mesh_from_bm("orb", bm_sphere(0.03, G(0, top + 0.03, 0), u=16, v=12), M["glow"])
    for i in range(4):
        a = i / 4 * math.tau + 0.4
        c, s = math.cos(a), math.sin(a)
        tube(f"claw{i}", [(0, top, 0), (c * 0.05, top + 0.02, s * 0.05), (c * 0.055, top + 0.07, s * 0.055), (c * 0.02, top + 0.085, s * 0.02)], 0.01, M["bone"])

    for nm, y in (("sword_base", Gd - 0.06), ("sword_tip", Y(1.0))):
        e = link(bpy.data.objects.new(nm, None))
        e.location = G(0, y, 0)

    log("sword tris", sum(tris(o) for o in bpy.context.scene.objects if o.type == "MESH"))
    export(os.path.join(MODELS, "demon_sword.glb"), "demon_sword.blend")


# ── Bow + arrow ──────────────────────────────────────────────────────────────
def build_bow():
    """Recurve bow (limbs along +Y, facing +Z, string side -Z, grip at origin) and an arrow along +Z."""
    reset()
    M = {
        "bone": material("Bone", (0.82, 0.69, 0.55), rough=0.55),
        "dread": material("Dread", (0.16, 0.035, 0.045), metal=0.3, rough=0.45, emit=(0.05, 0.0, 0.005), strength=1.0),
        "glow": material("Glow", (0.7, 0.0, 0.0), rough=0.4, emit=(1.0, 0.0, 0.0), strength=2.2),
        "blood": material("BloodCloth", (0.4, 0.02, 0.04), rough=0.8),
        "iron": material("Iron", (0.2, 0.19, 0.2), metal=0.85, rough=0.35),
        "shaft": material("Shaft", (0.12, 0.07, 0.05), rough=0.7),
    }
    bow = link(bpy.data.objects.new("Bow", None))
    for sy in (1, -1):
        # Limb sweeps back toward the archer, then the tip recurves forward.
        pts = [(0, sy * 0.06, 0.012), (0, sy * 0.22, -0.035), (0, sy * 0.4, -0.1), (0, sy * 0.53, -0.12), (0, sy * 0.6, -0.085), (0, sy * 0.63, -0.04)]
        limb = tube(f"limb{sy}", pts, 0.022, M["dread"], taper=0.45, res=3)
        limb.scale = (1.5, 0.75, 1)  # flat, wide limb (Blender X = width, Y = thickness)
        limb = bake(limb, f"limb{sy}", smooth=True)
        parent(limb, bow)
        rune = tube(f"rune{sy}", [(0, sy * 0.1, 0.022), (0, sy * 0.24, -0.015), (0, sy * 0.38, -0.075)], 0.0045, M["glow"], taper=0.5)
        parent(rune, bow)
        cap = tube(f"tip{sy}", [(0, sy * 0.59, -0.1), (0, sy * 0.635, -0.055), (0, sy * 0.66, 0.0)], 0.012, M["bone"], taper=0.15)
        parent(cap, bow)
        spur = tube(f"spur{sy}", [(0, sy * 0.3, -0.06), (0.0, sy * 0.33, -0.0), (0.0, sy * 0.31, 0.04)], 0.007, M["bone"], taper=0.1)
        parent(spur, bow)
    riser = mesh_from_bm("riser", bm_cyl(0.024, 0.024, 0.16, seg=12), M["dread"])
    parent(riser, bow)
    for i in range(5):
        w = mesh_from_bm(f"gripwrap{i}", bm_torus(0.026, 0.006, (0, 0, -0.06 + i * 0.03), seg=14, rseg=5), M["blood"])
        parent(w, bow)
    eye = mesh_from_bm("eye", bm_sphere(0.012, G(0, 0.09, 0.025), u=10, v=8), M["glow"])
    parent(eye, bow)
    for nm, y in (("bow_tip_top", 0.625), ("bow_tip_bottom", -0.625)):
        e = link(bpy.data.objects.new(nm, None))
        e.location = G(0, y, -0.05)
        parent(e, bow)

    arrow = link(bpy.data.objects.new("Arrow", None))
    shaft = mesh_from_bm("shaft", bm_cyl(0.0055, 0.0055, 0.7, seg=8), M["shaft"])
    shaft.matrix_world = Matrix.Translation(G(0, 0, 0.36)) @ Matrix.Rotation(math.pi / 2, 4, "X")
    parent(shaft, arrow)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.022, radius2=0.0, depth=0.075)
    head = mesh_from_bm("broadhead", bm, M["iron"], smooth=False)
    head.matrix_world = Matrix.Translation(G(0, 0, 0.745)) @ Matrix.Rotation(-math.pi / 2, 4, "X") @ Matrix.Diagonal((1, 0.25, 1, 1))
    parent(head, arrow)
    for i in range(3):
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in ((0, 0, 0), (0.028, 0, 0.015), (0.022, 0, 0.11), (0, 0, 0.13))]
        bm.faces.new(vs)
        f = mesh_from_bm(f"fletch{i}", bm, M["blood"], smooth=False)
        so = f.modifiers.new("t", "SOLIDIFY")
        so.thickness = 0.0015
        f = bake(f, f"fletch{i}")
        f.matrix_world = Matrix.Rotation(i * math.tau / 3, 4, "Y") @ Matrix.Translation(G(0, 0, 0.02))
        parent(f, arrow)
    nock = mesh_from_bm("nock", bm_cyl(0.008, 0.006, 0.02, (0, 0, 0)), M["bone"])
    nock.matrix_world = Matrix.Translation(G(0, 0, 0.008)) @ Matrix.Rotation(math.pi / 2, 4, "X")
    parent(nock, arrow)
    arrow.location = G(0.5, 0, 0)  # beside the bow in the .blend; the game zeroes it
    export(os.path.join(MODELS, "bow.glb"), "bow.blend")


# ── Class weapons ────────────────────────────────────────────────────────────
def build_class_weapons():
    """Dagger, mace, great axe and staff. Same convention as the demon sword: hand at the origin,
    striking end along game -Y, grip upward; each root has <Name>_base / <Name>_tip empties for trails."""
    reset()
    M = {
        "steel": material("DarkSteel", (0.25, 0.25, 0.28), metal=0.9, rough=0.3),
        "edge": material("RedEdge", (0.6, 0.05, 0.05), metal=0.6, rough=0.3, emit=(0.8, 0.02, 0.0), strength=1.5),
        "leather": material("Leather", (0.18, 0.1, 0.06), rough=0.8),
        "gold": material("HolyGold", (0.85, 0.66, 0.3), metal=1.0, rough=0.3),
        "holy": material("HolyGlow", (1.0, 0.9, 0.6), emit=(1.0, 0.85, 0.45), strength=2.5),
        "wood": material("DarkWood", (0.18, 0.11, 0.07), rough=0.85),
        "iron": material("Iron", (0.2, 0.19, 0.2), metal=0.85, rough=0.4),
        "bone": material("Bone", (0.82, 0.74, 0.62), rough=0.6),
        "void": material("VoidGlow", (0.35, 0.1, 0.8), emit=(0.55, 0.15, 1.0), strength=3.0),
    }

    def root(name, base_y, tip_y):
        r = link(bpy.data.objects.new(name, None))
        for suf, y in (("_base", base_y), ("_tip", tip_y)):
            e = link(bpy.data.objects.new(name + suf, None))
            e.location = G(0, y, 0)
            parent(e, r)
        return r

    def own(r, *objs):
        for o in objs:
            parent(o, r)

    def blade(name, pts2d, thick, mat):
        bm = bmesh.new()
        vs = [bm.verts.new(G(x, y, 0)) for x, y in pts2d]
        bm.faces.new(vs)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        o = mesh_from_bm(name, bm, mat, smooth=False)
        so = o.modifiers.new("t", "SOLIDIFY")
        so.thickness = thick
        so.offset = 0
        return bake(o, name, smooth=False)

    # Dagger: wavy kris blade with a red-lit edge.
    r = root("Dagger", -0.12, -0.53)
    L = 0.42
    right = [(0.026 * (1 - t) + 0.008 * math.sin(t * 14), -0.1 - t * L) for t in [i / 20 for i in range(21)]]
    left = [(-0.026 * (1 - t) + 0.008 * math.sin(t * 14), -0.1 - t * L) for t in [i / 20 for i in range(21)]]
    own(r, blade("dagger_edge", right + [(0.004, -0.1 - L - 0.03)] + left[::-1], 0.006, M["edge"]))
    inner = [(x * 0.7, y) for x, y in right[:-2]] + [(x * 0.7, y) for x, y in left[:-2][::-1]]
    own(r, blade("dagger_blade", inner, 0.011, M["steel"]))
    own(r, mesh_from_bm("dagger_guard", bm_cube(0.12, 0.03, 0.025, G(0, -0.095, 0)), M["iron"], smooth=False))
    own(r, mesh_from_bm("dagger_grip", bm_cyl(0.017, 0.017, 0.12, G(0, -0.03, 0), seg=10), M["leather"]))
    own(r, mesh_from_bm("dagger_pommel", bm_sphere(0.024, G(0, 0.04, 0)), M["iron"]))

    # Mace: flanged golden head with holy runes on a short haft.
    r = root("Mace", -0.1, -0.68)
    own(r, mesh_from_bm("mace_haft", bm_cyl(0.019, 0.019, 0.62, G(0, -0.25, 0), seg=10), M["wood"]))
    own(r, mesh_from_bm("mace_grip", bm_cyl(0.022, 0.022, 0.16, G(0, 0.0, 0), seg=10), M["leather"]))
    own(r, mesh_from_bm("mace_core", bm_sphere(0.06, G(0, -0.6, 0), scale=(1, 1, 1.3)), M["gold"]))
    for i in range(7):
        a = i / 7 * math.tau
        fl = mesh_from_bm(f"mace_flange{i}", bm_cube(0.012, 0.11, 0.17), M["gold"], smooth=False)
        fl.matrix_world = Matrix.Translation(G(math.cos(a) * 0.06, -0.6, math.sin(a) * 0.06)) @ Matrix.Rotation(-a, 4, "Z")
        own(r, fl)
    for y in (-0.53, -0.67):
        own(r, mesh_from_bm(f"mace_rune{y}", bm_torus(0.068, 0.006, G(0, y, 0), seg=20, rseg=5), M["holy"]))
    own(r, mesh_from_bm("mace_spike", bm_cyl(0.025, 0.0, 0.08, G(0, -0.7, 0), seg=8), M["gold"]))

    # Great axe: crescent head with a back spike on a long haft.
    r = root("Axe", -0.7, -1.1)
    own(r, mesh_from_bm("axe_haft", bm_cyl(0.022, 0.024, 1.15, G(0, -0.4, 0), seg=10), M["wood"]))
    own(r, mesh_from_bm("axe_grip", bm_cyl(0.026, 0.026, 0.22, G(0, 0.06, 0), seg=10), M["leather"]))
    head = [(0.02, -0.78), (0.12, -0.74), (0.22, -0.68), (0.27, -0.8), (0.29, -0.92), (0.27, -1.04), (0.22, -1.14), (0.12, -1.06), (0.02, -1.02)]
    own(r, blade("axe_head", head, 0.03, M["iron"]))
    edge = [(0.22, -0.68), (0.27, -0.8), (0.29, -0.92), (0.27, -1.04), (0.22, -1.14), (0.255, -1.04), (0.272, -0.92), (0.255, -0.8)]
    own(r, blade("axe_edge", edge, 0.034, M["edge"]))
    own(r, blade("axe_spike", [(-0.02, -0.84), (-0.17, -0.9), (-0.02, -0.96)], 0.028, M["iron"]))
    own(r, mesh_from_bm("axe_cap", bm_cyl(0.035, 0.03, 0.06, G(0, -0.99, 0), seg=10), M["iron"]))

    # Staff: gnarled bone shaft, a skull and a void orb at the striking end.
    r = root("Staff", -0.9, -1.35)
    pts = [(0.01 * math.sin(i * 1.7), 0.25 - i * 0.12, 0.012 * math.cos(i * 2.3)) for i in range(12)]
    own(r, tube("staff_shaft", pts, 0.022, M["bone"], taper=0.7, res=3))
    for i, y in enumerate((-0.25, -0.6, -0.95)):
        own(r, mesh_from_bm(f"staff_band{i}", bm_torus(0.026, 0.006, G(0, y, 0), seg=14, rseg=5), M["iron"]))
    own(r, mesh_from_bm("staff_skull", bm_sphere(0.07, G(0, -1.18, 0.01), scale=(0.95, 1.05, 1.1)), M["bone"]))
    for x in (-0.026, 0.026):
        own(r, mesh_from_bm("staff_eye", bm_sphere(0.014, G(x, -1.19, 0.07), u=8, v=6), M["void"]))
    own(r, mesh_from_bm("staff_orb", bm_sphere(0.05, G(0, -1.32, 0)), M["void"]))
    for i in range(3):
        a = i / 3 * math.tau
        own(r, tube(f"staff_claw{i}", [(0, -1.24, 0), (math.cos(a) * 0.06, -1.28, math.sin(a) * 0.06), (math.cos(a) * 0.03, -1.37, math.sin(a) * 0.03)], 0.008, M["bone"]))

    export(os.path.join(MODELS, "weapons.glb"), "weapons.blend")


build_sword()
build_class_weapons()
build_bow()
build_hero()
log("done")
