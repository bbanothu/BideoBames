"""Turns the 500k-triangle "Ritual Woman" sculpt into the game's skinned hero.

Run headless:  blender -b --factory-startup --python blender/build_ritual.py -- <repo>/sword
(blender/build.sh runs this after build_assets.py when the source file is present).

Steps: import -> scale to 1.75 m and recentre on the body (the robe trails behind) -> decimate ->
shrink textures -> armature whose bones match the game rig's joints -> computed skin weights
(robe/skirt rides the hips, limbs blend at the joints) -> export assets/models/ritual.glb.
The game rebinds this skin to its own joint groups, using the bone positions as landmarks.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.getcwd()
SRC = os.path.join(ROOT, "assets", "source", "ritual_women_500k.glb")
OUT = os.path.join(ROOT, "assets", "models", "ritual.glb")
TARGET_TRIS = 60000
HEIGHT = 1.75
SRC_HEIGHT = 1.0522
OFFSET = (-0.01, 0.0, -0.17)  # game-space shift that puts the body (not the robe train) on the origin


def log(*a):
    print("[ritual]", *a, flush=True)


def G(x, y, z):  # game (Y-up, +Z forward) -> Blender (Z-up, -Y forward)
    return Vector((x, -z, y))


# Joint landmarks in game space after scaling/recentring, measured from orthographic renders.
J = {"pelvis": (0, 0.93, 0), "waist": (0, 1.06, 0), "neck": (0, 1.41, -0.01), "top": (0, 1.75, -0.02)}
for side, s in (("L", 1), ("R", -1)):
    J["sh_" + side] = (s * 0.14, 1.346, -0.02)
    J["el_" + side] = (s * 0.214, 1.176, -0.005)
    J["wr_" + side] = (s * 0.284, 1.025, 0.01)
    J["hip_" + side] = (s * 0.09, 0.875, 0.02)
    J["kn_" + side] = (s * 0.07, 0.457, 0.04)
    J["an_" + side] = (s * 0.05, 0.072, -0.02)
J = {k: Vector(v) for k, v in J.items()}

# bone: (head, tail, parent) — names match the game's rig joints.
BONES = {"hips": ("pelvis", "waist", None), "torso": ("waist", "neck", "hips"), "head": ("neck", "top", "torso")}
for sd in ("L", "R"):
    BONES["upperarm_" + sd] = ("sh_" + sd, "el_" + sd, "torso")
    BONES["forearm_" + sd] = ("el_" + sd, "wr_" + sd, "upperarm_" + sd)
    BONES["hand_" + sd] = ("wr_" + sd, None, "forearm_" + sd)
    BONES["thigh_" + sd] = ("hip_" + sd, "kn_" + sd, "hips")
    BONES["shin_" + sd] = ("kn_" + sd, "an_" + sd, "thigh_" + sd)
    BONES["foot_" + sd] = ("an_" + sd, None, "shin_" + sd)  # landmark only (ankle height)


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def seg(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length, t


def weights_for(p):
    """Skin weights for one vertex (game-space position)."""
    w = {}

    def add(b, v):
        if v > 1e-4:
            w[b] = w.get(b, 0) + v

    # Arms: anything near the arm chain and outboard of the ribcage.
    for sd, s in (("L", 1), ("R", -1)):
        sh, el, wr = J["sh_" + sd], J["el_" + sd], J["wr_" + sd]
        hand_end = wr + (wr - el).normalized() * 0.13
        du, tu = seg(p, sh, el)
        df, _ = seg(p, el, wr)
        dh, _ = seg(p, wr, hand_end)
        lateral = p.x * s > 0.115
        # Tight radii below the elbow: the robe's cords hang right beside the A-posed hands.
        near = du < 0.08 or (df < 0.058 and p.x * s > 0.17) or (dh < 0.06 and p.x * s > 0.215)
        if near and (lateral or (du < 0.055 and tu > 0.35)):
            parts = {"upperarm_" + sd: du, "forearm_" + sd: df, "hand_" + sd: dh}
            raw = {b: math.exp(-((d / 0.03) ** 2)) for b, d in parts.items()}
            tot = sum(raw.values()) or 1
            torso_share = 0.6 * (1 - smoothstep(0.0, 0.3, tu)) if du <= min(df, dh) else 0
            for b, v in raw.items():
                add(b, v / tot * (1 - torso_share))
            add("torso", torso_share)
            return w

    # Legs: close to the leg axes below the pelvis. Everything else down there is robe -> hips.
    if p.y < 0.98:
        for sd in ("L", "R"):
            hp, kn, an = J["hip_" + sd], J["kn_" + sd], J["an_" + sd]
            dt, tt = seg(p, hp, kn)
            ds, _ = seg(p, kn, an)
            r_thigh = 0.1 - 0.035 * tt
            foot = p.y < 0.1 and abs(p.x - an.x) < 0.045 and -0.045 < p.z - an.z < 0.17
            if dt < r_thigh or ds < 0.062 or foot:
                shin = smoothstep(-0.04, 0.04, kn.y - p.y)
                top = smoothstep(hp.y - 0.1, hp.y + 0.04, p.y)
                add("shin_" + sd, shin)
                add("thigh_" + sd, (1 - shin) * (1 - top))
                add("hips", (1 - shin) * top)
                return w

    # Head / hood above the neck, blended into the torso.
    if p.y > J["neck"].y - 0.04 and abs(p.x) < 0.165:
        h = smoothstep(J["neck"].y - 0.04, J["neck"].y + 0.05, p.y)
        add("head", h)
        add("torso", 1 - h)
        return w

    t = smoothstep(0.96, 1.12, p.y)
    add("torso", t)
    add("hips", 1 - t)
    return w


CHAINS = 16  # skirt strands around the waist
SEGS = 6  # nodes per strand (waist .. hem)
Y0 = 0.98  # waist ring height


def is_robe(p):
    """Robe cloth, as opposed to the pelvis/buttocks it hangs over."""
    return p.y < Y0 and (p.y < 0.8 or math.hypot(p.x, p.z) > 0.17)


def angle_of(p):
    return math.atan2(p.x, p.z) % math.tau  # 0 = front (+Z), increasing toward +X


def fit_skirt(P, W):
    """One strand per angular sector, following the robe's outer envelope from waist to hem."""
    robe = [p for p, w in zip(P, W) if max(w, key=w.get) == "hips" and is_robe(p)]
    sector = math.tau / CHAINS
    chains = []
    for ci in range(CHAINS):
        th = ci * sector
        pts = [p for p in robe if abs((angle_of(p) - th + math.pi) % math.tau - math.pi) < sector * 0.75]
        ys = sorted(p.y for p in pts)
        hem = max(0.02, ys[len(ys) // 20]) if ys else 0.1
        nodes = []
        r_prev = 0.14
        for j in range(SEGS):
            y = Y0 - (Y0 - hem) * j / (SEGS - 1)
            band = sorted(math.hypot(p.x, p.z) for p in pts if abs(p.y - y) < 0.07)
            r = band[int(len(band) * 0.85)] if band else r_prev
            r = max(r, 0.12)
            r_prev = r
            nodes.append(Vector((r * math.sin(th), y, r * math.cos(th))))
        chains.append(nodes)
    log("skirt hems", [round(c[-1].y, 2) for c in chains], "reach", [round(math.hypot(c[-1].x, c[-1].z), 2) for c in chains])
    return chains


def cloth_weights(p, chains):
    """Blend across the two nearest strands and the two nearest segments; ramp into the hips at the waist."""
    a = angle_of(p) / (math.tau / CHAINS)
    i0 = int(a) % CHAINS
    i1 = (i0 + 1) % CHAINS
    fa = a - int(a)
    w = {}
    for ci, wa in ((i0, 1 - fa), (i1, fa)):
        nodes = chains[ci]
        hem = nodes[-1].y
        s = max(0.0, min(SEGS - 1, (Y0 - p.y) / max(0.05, Y0 - hem) * (SEGS - 1)))
        b = min(int(s), SEGS - 2)
        fb = min(1.0, s - b)
        nb = min(b + 1, SEGS - 2)
        for bone, wb in ((b, 1 - fb), (nb, fb)):
            key = f"skirt_{ci}_{bone}"
            w[key] = w.get(key, 0) + wa * wb
    ramp = smoothstep(Y0, Y0 - 0.12, p.y)
    w = {k: v * ramp for k, v in w.items() if v * ramp > 1e-4}
    if ramp < 1:
        w["hips"] = 1 - ramp
    return w


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    me = obj.data
    me.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    k = HEIGHT / SRC_HEIGHT
    me.transform(Matrix.Translation(G(*OFFSET)) @ Matrix.Scale(k, 4))
    log("source tris", sum(len(p.vertices) - 2 for p in me.polygons))

    m = obj.modifiers.new("dec", "DECIMATE")
    m.ratio = TARGET_TRIS / sum(len(p.vertices) - 2 for p in me.polygons)
    dg = bpy.context.evaluated_depsgraph_get()
    new_me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.clear()
    old = obj.data
    obj.data = new_me
    bpy.data.meshes.remove(old)
    me = obj.data
    obj.name = me.name = "ritual"
    log("decimated tris", sum(len(p.vertices) - 2 for p in me.polygons))

    for img in bpy.data.images:
        if img.size[0] > 0:
            size = 2048 if img.name.endswith("20250901") or "normal" not in img.name and "metallic" not in img.name else 1024
            log("texture", img.name, tuple(img.size), "->", size)
            img.scale(size, size)

    # Rigid weights first (they decide which vertices are robe), then fit skirt chains to the robe.
    P = [Vector((v.co.x, v.co.z, -v.co.y)) for v in me.vertices]
    W = [weights_for(p) for p in P]
    chains = fit_skirt(P, W)
    for i, p in enumerate(P):
        cw = cloth_weights(p, chains)
        if cw and max(W[i], key=W[i].get) == "hips" and is_robe(p):
            W[i] = cw

    # Armature at the landmarks, plus the skirt chains hanging from the hips.
    arm = bpy.data.armatures.new("rig")
    rig = bpy.data.objects.new("rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, par) in BONES.items():
        eb = arm.edit_bones.new(name)
        eb.head = G(*J[h])
        if t:
            eb.tail = G(*J[t])
        else:
            prev = BONES[par]
            d = (J[h] - J[prev[0]]).normalized() * 0.08
            eb.tail = G(*(J[h] + d))
        if par:
            eb.parent = arm.edit_bones[par]
    for ci, nodes in enumerate(chains):
        for j, n in enumerate(nodes):
            eb = arm.edit_bones.new(f"skirt_{ci}_{j}")
            eb.head = G(*n)
            eb.tail = G(*(nodes[j + 1] if j + 1 < len(nodes) else n + Vector((0, -0.05, 0))))
            eb.parent = arm.edit_bones["hips" if j == 0 else f"skirt_{ci}_{j - 1}"]
    bpy.ops.object.mode_set(mode="OBJECT")

    names = [n for n in BONES if not n.startswith("foot")] + [f"skirt_{c}_{j}" for c in range(len(chains)) for j in range(SEGS - 1)]
    groups = {n: obj.vertex_groups.new(name=n) for n in names}
    counts = {}
    for v, w in zip(me.vertices, W):
        top4 = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(val for _, val in top4)
        for bone, val in top4:
            groups[bone].add([v.index], val / tot, "REPLACE")
        top = top4[0][0].split("_")[0] if top4[0][0].startswith("skirt") else top4[0][0]
        counts[top] = counts.get(top, 0) + 1
    log("dominant-bone vertex counts", dict(sorted(counts.items())))

    obj.parent = rig
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "ritual.blend"))
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_image_format="WEBP",
        export_image_quality=88,
        export_cameras=False,
        export_lights=False,
    )
    log("exported", OUT, os.path.getsize(OUT) // 1024, "KB")


if os.path.exists(SRC):
    main()
else:
    log("source model missing, skipped:", SRC)
