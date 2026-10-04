"""Turns the character sources (char_1..4 .blend, villain_1 skeleton) into game-ready skinned .glb files.

Run headless, one model per Blender process:
    blender -b <source.blend> --python blender/build_characters.py -- <repo>/sword <model_id>
(blender/build.sh characters runs them all; on ARM Linux it wraps Blender in muvm.)

Every model ends up on the same skeleton as the game rig (hips, torso, head, upperarm_L, ... see BONES),
so all poses, IK, cloth and dismemberment work unchanged. Rigged sources keep their own skin weights,
remapped from their bone names (Rigify DEF/ORG, Character Creator CC_Base_*). Unrigged sculpts get joints
estimated from body proportions and geometric weights; skirts get the cloth-sim strand chains.
"""

import math
import os
import re
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = sys.argv[sys.argv.index("--") + 1]
MODEL = sys.argv[sys.argv.index("--") + 2]
OUT = os.path.join(ROOT, "assets", "models", MODEL + ".glb")

# height (m), triangle budget, and per-model fixes.
CONFIG = {
    "char_1": {"height": 1.86, "tris": 50000},
    # The two sculpts reference texture files that aren't packed or present: fall back to a solid tint.
    "char_2": {"height": 1.72, "tris": 50000, "yaw": -90, "skirt": False, "tint": (0.5, 0.53, 0.6), "metal": 0.35, "rough": 0.4},
    "char_3": {"height": 1.70, "tris": 55000, "tint": (0.92, 0.9, 0.87), "metal": 0.0, "rough": 0.7},
    "char_4": {"height": 1.70, "tris": 60000},
    "villain_1": {"height": 1.80, "tris": 40000},
}
CFG = CONFIG[MODEL]
H = CFG["height"]


def log(*a):
    print("[chars]", MODEL, *a, flush=True)


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def seg(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (p - (a + ab * t)).length, t


# Game space: x = character's left, y = up, z = forward. Blender export maps (x, y, z)b -> (x, z, -y)g.
def g2b(v):
    return Vector((v.x, -v.z, v.y))


def b2g(v):
    return Vector((v.x, v.z, -v.y))


# ── 1. Collect the character's meshes in bind (rest) pose ──────────────────
def deform_armature(o):
    for m in o.modifiers:
        if m.type == "ARMATURE" and m.object:
            return m.object
    if o.parent and o.parent.type == "ARMATURE":
        return o.parent
    return None


def collect():
    meshes = []
    for o in bpy.data.objects:
        if o.type != "MESH" or o.name.startswith("WGT-") or len(o.data.polygons) < 50:
            continue
        if o.hide_render or not o.visible_get():
            continue
        dims = o.dimensions
        if len(o.data.polygons) < 4 or (dims.z < 0.01 and dims.x > 5):
            continue  # ground planes
        meshes.append(o)
    arms = {deform_armature(o) for o in meshes} - {None}
    for a in arms:
        a.data.pose_position = "REST"
    # Keep the geometry light: no subdivision.
    for o in meshes:
        for m in o.modifiers:
            if m.type == "SUBSURF":
                m.levels = 0
                m.render_levels = 0
    bpy.context.view_layer.update()
    arm = max(arms, key=lambda a: len(a.data.bones)) if arms else None
    log("meshes", [o.name for o in meshes][:12], "armature", arm.name if arm else None)
    return meshes, arm


# ── 2. Bone-name → game-bone mapping ───────────────────────────────────────
def side_of(name):
    n = name
    if re.search(r"(\.L|_L|\.l|Left|left)(\.\d+)?$", n) or re.search(r"(^|_)L_", n) or ".L." in n:
        return "L"
    if re.search(r"(\.R|_R|\.r|Right|right)(\.\d+)?$", n) or re.search(r"(^|_)R_", n) or ".R." in n:
        return "R"
    return None


def game_bone(name):
    n = name.lower()
    s = side_of(name)
    if any(k in n for k in ("head", "neck", "eye", "jaw", "face", "teeth", "tongue", "brow", "lid", "lip", "cheek", "nose", "ear", "chin", "forehead", "temple", "hair")):
        return "head"
    if s:
        if any(k in n for k in ("hand", "thumb", "index", "middle", "ring", "pinky", "palm", "finger", "f_")):
            return "hand_" + s
        if "forearm" in n or "lowerarm" in n or "elbow" in n:
            return "forearm_" + s
        if "upper_arm" in n or "upperarm" in n or "arm" in n:
            return "upperarm_" + s
        if "thigh" in n or "upleg" in n or "upperleg" in n:
            return "thigh_" + s
        if any(k in n for k in ("shin", "calf", "knee", "foot", "toe", "heel", "leg", "ankle")):
            return "shin_" + s
        if "pelvis" in n or "hip" in n or "butt" in n or "glute" in n:
            return "hips"
        return "torso"  # shoulder, clavicle, breast, ...
    m = re.search(r"spine\.?(\d+)?", n)
    if m:
        k = int(m.group(1)) if m.group(1) else 0
        if "cc_base" in n:
            return "torso"
        return "hips" if k <= 1 else "torso" if k <= 3 else "head"
    if any(k in n for k in ("pelvis", "hip", "root", "waist")):
        return "hips"
    return "torso"


# ── 3. Merge everything into one normalised, decimated mesh with game-bone weights ─
def merge(meshes, arm):
    dg = bpy.context.evaluated_depsgraph_get()
    parts = []
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        me.transform(o.matrix_world)
        # One shared UV map name so joined parts keep their texture coordinates.
        if me.uv_layers:
            me.uv_layers.active.name = "UVMap"
            for uv in list(me.uv_layers):
                if uv.name != "UVMap":
                    me.uv_layers.remove(uv)
        # Weights per vertex, already mapped to game bones.
        names = [g.name for g in o.vertex_groups]
        wts = [dict() for _ in me.vertices]
        if names and len(me.vertices) and any(v.groups for v in me.vertices):
            for v in me.vertices:
                for ge in v.groups:
                    if ge.group < len(names) and ge.weight > 1e-4:
                        b = game_bone(names[ge.group])
                        wts[v.index][b] = wts[v.index].get(b, 0) + ge.weight
        elif o.parent_type == "BONE" and o.parent_bone:
            b = game_bone(o.parent_bone)
            wts = [{b: 1.0} for _ in me.vertices]
        parts.append((me, wts))
    # Join into one mesh, keeping materials.
    bm = bmesh.new()
    allw = []
    mats = []
    for me, wts in parts:
        base = len(bm.verts)
        remap = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m) if m else 0)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        for f in tmp.faces:
            f.material_index = remap[f.material_index] if f.material_index < len(remap) else 0
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        allw.extend(wts)
    # Weights now live in `allw`; drop the source rigs' deform layers so new groups start clean.
    while bm.verts.layers.deform.active:
        bm.verts.layers.deform.remove(bm.verts.layers.deform.active)
    out = bpy.data.meshes.new(MODEL)
    bm.to_mesh(out)
    bm.free()
    for m in mats:
        out.materials.append(m)
    obj = bpy.data.objects.new(MODEL, out)
    bpy.context.scene.collection.objects.link(obj)
    return obj, allw


def normalise(obj, arm):
    """Upright (+Z), facing -Y (= game +Z), feet on the floor, torso on the origin, scaled to H."""
    me = obj.data
    P = [v.co.copy() for v in me.vertices]
    lo = Vector([min(p[i] for p in P) for i in range(3)])
    hi = Vector([max(p[i] for p in P) for i in range(3)])
    ext = hi - lo
    up = max(range(3), key=lambda i: ext[i])
    if arm:
        # A rig knows which way is up (arm span can beat height in a T-pose): feet → head.
        bones = arm.data.bones
        top = max(bones, key=lambda b: ("head" in b.name.lower()) * 2 + ("spine.006" in b.name.lower()) * 3)
        low = min(bones, key=lambda b: (b.head_local - top.head_local).length * -1 if "foot" in b.name.lower() else 1e9)
        d = arm.matrix_world.to_3x3() @ (top.head_local - low.head_local)
        up = max(range(3), key=lambda i: abs(d[i]))
    R = Matrix.Identity(4)
    if up == 1:
        R = Matrix.Rotation(math.radians(90), 4, "X")
    elif up == 0:
        R = Matrix.Rotation(math.radians(-90), 4, "Y")
    me.transform(R)
    P = [v.co.copy() for v in me.vertices]
    zmin = min(p.z for p in P)
    zmax = max(p.z for p in P)
    h = zmax - zmin
    # Upside down? Feet (two narrow columns) are thinner than shoulders.
    def width(z0, z1):
        xs = [p.x for p in P if z0 <= p.z <= z1]
        return (max(xs) - min(xs)) if xs else 0
    if width(zmin, zmin + 0.06 * h) > width(zmax - 0.3 * h, zmax - 0.2 * h) * 1.6:
        me.transform(Matrix.Rotation(math.pi, 4, "X"))
        R = Matrix.Rotation(math.pi, 4, "X") @ R
        P = [v.co.copy() for v in me.vertices]
        zmin, zmax = min(p.z for p in P), max(p.z for p in P)
        h = zmax - zmin
    k = H / h
    torso = [p for p in P if zmin + 0.42 * h < p.z < zmin + 0.62 * h]
    cx = sorted(p.x for p in torso)[len(torso) // 2]
    cy = sorted(p.y for p in torso)[len(torso) // 2]
    T = Matrix.Scale(k, 4) @ Matrix.Translation(Vector((-cx, -cy, -zmin)))
    me.transform(T)
    M = T @ R
    # Facing: toes point forward (-Y in Blender) relative to the shins.
    P = [v.co.copy() for v in me.vertices]
    feet = [p for p in P if p.z < 0.035 * H]
    knee = [p for p in P if 0.26 * H < p.z < 0.32 * H]
    if "yaw" in CFG:
        th = math.radians(CFG["yaw"])
        me.transform(Matrix.Rotation(th, 4, "Z"))
        M = Matrix.Rotation(th, 4, "Z") @ M
    elif feet and knee and not arm:
        # Toes point forward: turn (in 90° steps) so feet-minus-shins points along -Y.
        vx = sum(p.x for p in feet) / len(feet) - sum(p.x for p in knee) / len(knee)
        vy = sum(p.y for p in feet) / len(feet) - sum(p.y for p in knee) / len(knee)
        if math.hypot(vx, vy) > 0.004 * H:
            th = -math.pi / 2 - math.atan2(vy, vx)
            th = round(th / (math.pi / 2)) * (math.pi / 2)
            if abs(th) > 1e-3:
                me.transform(Matrix.Rotation(th, 4, "Z"))
                M = Matrix.Rotation(th, 4, "Z") @ M
                log("turned", round(math.degrees(th)), "deg to face forward")
    me.update()
    return M


def decimate(obj, wts, target):
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris <= target:
        return wts
    # Stash weights in vertex groups so the decimator carries them along.
    names = sorted({b for w in wts for b in w})
    groups = {n: obj.vertex_groups.new(name=n) for n in names}
    for i, w in enumerate(wts):
        for b, val in w.items():
            groups[b].add([i], val, "REPLACE")
    m = obj.modifiers.new("dec", "DECIMATE")
    m.ratio = target / tris
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    obj.modifiers.clear()
    old = obj.data
    obj.data = me
    bpy.data.meshes.remove(old)
    out = [dict() for _ in me.vertices]
    idx = {g.index: g.name for g in obj.vertex_groups}
    for v in me.vertices:
        for ge in v.groups:
            if ge.weight > 1e-4:
                out[v.index][idx[ge.group]] = ge.weight
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    log("decimated", tris, "->", sum(len(p.vertices) - 2 for p in me.polygons))
    return out


# ── 4. Joint landmarks (game space) ────────────────────────────────────────
def landmarks_from_rig(arm, M):
    J = {}
    bones = {b.name: b for b in arm.data.bones}
    W = arm.matrix_world

    def find(*pats, side=None):
        for prefer in ("ORG-", "DEF-", ""):
            for b in bones.values():
                n = b.name.lower()
                if prefer and not b.name.startswith(prefer):
                    continue
                if side and side_of(b.name) != side:
                    continue
                if any(re.search(p, n) for p in pats):
                    return b
        return None

    def at(b, tail=False):
        return b2g(M @ (W @ (b.tail_local if tail else b.head_local)))

    sp = find(r"^(org-|def-)?spine$", r"hips$", r"pelvis")
    nk = find(r"spine\.004$", r"neck")
    hd = find(r"spine\.006$", r"^(org-|def-)?head$", r"cc_base_head$")
    if sp:
        J["pelvis"] = at(sp)
    if nk:
        J["neck"] = at(nk)
    if hd:
        J["top"] = at(hd, tail=True)
    for s in ("L", "R"):
        for key, pats in (("sh", (r"upper_?arm",)), ("el", (r"forearm", r"lowerarm")), ("wr", (r"hand$", r"hand\.", r"_hand$")), ("hip", (r"thigh", r"upleg")), ("kn", (r"shin", r"calf")), ("an", (r"foot$", r"foot\.", r"_foot$"))):
            b = find(*pats, side=s)
            if b:
                J[f"{key}_{s}"] = at(b)
    return J


def landmarks_from_shape(P):
    """Proportions + arm detection for unrigged sculpts. P: game-space points."""
    J = {}
    def mean(pts, default):
        if not pts:
            return default
        return Vector([sum(p[i] for p in pts) / len(pts) for i in range(3)])
    mid = mean([p for p in P if 0.5 * H < p.y < 0.62 * H and abs(p.x) < 0.12 * H], Vector((0, 0.56 * H, 0)))
    J["pelvis"] = Vector((0, 0.53 * H, mid.z))
    J["neck"] = Vector((0, 0.815 * H, mean([p for p in P if 0.79 * H < p.y < 0.84 * H and abs(p.x) < 0.06 * H], mid).z))
    J["top"] = Vector((0, H, J["neck"].z))
    for s, sx in (("L", 1), ("R", -1)):
        sh = Vector((sx * 0.105 * H, 0.81 * H, J["neck"].z))
        armv = [p for p in P if p.x * sx > 0.17 * H and 0.42 * H < p.y < 0.9 * H]
        if len(armv) > 200:
            xs = sorted(p.x * sx for p in armv)
            xw = xs[int(len(xs) * 0.97)] - 0.05 * H
            wr = mean([p for p in armv if p.x * sx > xw - 0.03 * H and p.x * sx < xw + 0.03 * H], sh)
            xe = (sh.x * sx + wr.x * sx) / 2
            el = mean([p for p in armv if abs(p.x * sx - xe) < 0.03 * H], (sh + wr) / 2)
        else:
            el = Vector((sx * 0.13 * H, 0.62 * H, sh.z))
            wr = Vector((sx * 0.15 * H, 0.48 * H, sh.z))
        J["sh_" + s], J["el_" + s], J["wr_" + s] = sh, el, wr
        kn = mean([p for p in P if 0.27 * H < p.y < 0.3 * H and 0.01 * H < p.x * sx < 0.12 * H], Vector((sx * 0.045 * H, 0.285 * H, mid.z)))
        an = mean([p for p in P if p.y < 0.06 * H and 0.0 < p.x * sx < 0.14 * H], Vector((sx * 0.04 * H, 0.045 * H, mid.z)))
        J["hip_" + s] = Vector((sx * 0.055 * H, 0.5 * H, mid.z))
        J["kn_" + s] = Vector((kn.x, 0.285 * H, kn.z))
        J["an_" + s] = Vector((an.x, 0.045 * H, an.z))
    return J


def complete(J, P):
    """Fill anything the rig didn't provide with proportional defaults."""
    d = landmarks_from_shape(P)
    for k, v in d.items():
        J.setdefault(k, v)
    J["waist"] = J["pelvis"].lerp(J["neck"], 0.4)
    J["top"] = Vector((J["neck"].x, max(J["top"].y, J["neck"].y + 0.1 * H), J["neck"].z))
    return J


# ── 5. Geometric weights (unrigged) ────────────────────────────────────────
def geo_weights(p, J):
    w = {}
    s1 = H / 1.75

    def add(b, v):
        if v > 1e-4:
            w[b] = w.get(b, 0) + v

    for sd, s in (("L", 1), ("R", -1)):
        sh, el, wr = J["sh_" + sd], J["el_" + sd], J["wr_" + sd]
        hand_end = wr + (wr - el).normalized() * 0.13 * s1
        du, tu = seg(p, sh, el)
        df, _ = seg(p, el, wr)
        dh, _ = seg(p, wr, hand_end)
        if min(du, df, dh) < 0.085 * s1 and (p.x * s > 0.11 * s1 or (du < 0.055 * s1 and tu > 0.35)):
            raw = {"upperarm_" + sd: du, "forearm_" + sd: df, "hand_" + sd: dh}
            raw = {b: math.exp(-((d / (0.03 * s1)) ** 2)) for b, d in raw.items()}
            tot = sum(raw.values()) or 1
            torso = 0.6 * (1 - smoothstep(0.0, 0.3, tu)) if du <= min(df, dh) else 0
            for b, v in raw.items():
                add(b, v / tot * (1 - torso))
            add("torso", torso)
            return w
    if p.y < J["pelvis"].y + 0.05 * s1:
        for sd in ("L", "R"):
            hp, kn, an = J["hip_" + sd], J["kn_" + sd], J["an_" + sd]
            dt, tt = seg(p, hp, kn)
            ds, _ = seg(p, kn, an)
            if dt < (0.1 - 0.035 * tt) * s1 or ds < 0.065 * s1 or (p.y < 0.1 * s1 and abs(p.x - an.x) < 0.06 * s1):
                shin = smoothstep(-0.04 * s1, 0.04 * s1, kn.y - p.y)
                top = smoothstep(hp.y - 0.1 * s1, hp.y + 0.04 * s1, p.y)
                add("shin_" + sd, shin)
                add("thigh_" + sd, (1 - shin) * (1 - top))
                add("hips", (1 - shin) * top)
                return w
    if p.y > J["neck"].y - 0.04 * s1 and abs(p.x) < 0.17 * s1:
        h = smoothstep(J["neck"].y - 0.04 * s1, J["neck"].y + 0.05 * s1, p.y)
        add("head", h)
        add("torso", 1 - h)
        return w
    t = smoothstep(J["pelvis"].y + 0.03 * s1, J["pelvis"].y + 0.19 * s1, p.y)
    add("torso", t)
    add("hips", 1 - t)
    return w


# ── 6. Skirts → cloth strands ──────────────────────────────────────────────
CHAINS, SEGS = 16, 6


def has_skirt(P):
    band = [p for p in P if 0.27 * H < p.y < 0.36 * H]
    gap = [p for p in band if abs(p.x) < 0.012 * H and p.z > -0.02 * H]
    return len(band) > 0 and len(gap) / len(band) > 0.03


def fit_skirt(P, W, J):
    y0 = J["pelvis"].y + 0.04 * H
    robe = [p for p, w in zip(P, W) if max(w, key=w.get) in ("hips",) or (p.y < y0 and max(w, key=w.get).startswith(("thigh", "shin")))]
    robe = [p for p in robe if p.y < y0 and (p.y < 0.45 * H or math.hypot(p.x, p.z) > 0.1 * H)]
    sector = math.tau / CHAINS
    chains = []
    for ci in range(CHAINS):
        th = ci * sector
        pts = [p for p in robe if abs((math.atan2(p.x, p.z) % math.tau - th + math.pi) % math.tau - math.pi) < sector * 0.75]
        ys = sorted(p.y for p in pts)
        hem = max(0.02, ys[len(ys) // 20]) if ys else 0.3 * H
        nodes, rp = [], 0.08 * H
        for j in range(SEGS):
            y = y0 - (y0 - hem) * j / (SEGS - 1)
            band = sorted(math.hypot(p.x, p.z) for p in pts if abs(p.y - y) < 0.04 * H)
            r = max(band[int(len(band) * 0.85)] if band else rp, 0.07 * H)
            rp = r
            nodes.append(Vector((r * math.sin(th), y, r * math.cos(th))))
        chains.append(nodes)
    return chains, y0


def cloth_weights(p, chains, y0):
    a = (math.atan2(p.x, p.z) % math.tau) / (math.tau / CHAINS)
    i0, fa = int(a) % CHAINS, a - int(a)
    w = {}
    for ci, wa in ((i0, 1 - fa), ((i0 + 1) % CHAINS, fa)):
        hem = chains[ci][-1].y
        s = max(0.0, min(SEGS - 1, (y0 - p.y) / max(0.05, y0 - hem) * (SEGS - 1)))
        b = min(int(s), SEGS - 2)
        fb = min(1.0, s - b)
        for bone, wb in ((b, 1 - fb), (min(b + 1, SEGS - 2), fb)):
            k = f"skirt_{ci}_{bone}"
            w[k] = w.get(k, 0) + wa * wb
    ramp = smoothstep(y0, y0 - 0.07 * H, p.y)
    w = {k: v * ramp for k, v in w.items() if v * ramp > 1e-4}
    if ramp < 1:
        w["hips"] = 1 - ramp
    return w


# ── 7. Materials the glTF exporter understands; smaller textures ───────────
def fix_materials(obj):
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        # Texture nodes whose image is missing (external file not found) would export as broken references.
        missing = [n for n in nt.nodes if n.type == "TEX_IMAGE" and (not n.image or n.image.size[0] == 0)]
        for n in missing:
            nt.nodes.remove(n)
        if missing and "tint" in CFG:
            for b in (n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"):
                b.inputs["Base Color"].default_value = (*CFG["tint"], 1)
                b.inputs["Metallic"].default_value = CFG["metal"]
                b.inputs["Roughness"].default_value = CFG["rough"]
            for n in [n for n in nt.nodes if n.type == "NORMAL_MAP"]:
                nt.nodes.remove(n)
            log("missing textures removed; using solid tint")
        if any(n.type == "BSDF_PRINCIPLED" for n in nt.nodes) and any(n.type == "OUTPUT_MATERIAL" for n in nt.nodes):
            continue
        imgs = [n.image for n in nt.nodes if getattr(n, "image", None)]
        pick = lambda *ks: next((im for im in imgs if any(k in im.name.lower() for k in ks)), None)
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(b.outputs[0], out.inputs[0])
        for key, sock, nonc in ((("basecolor", "albedo", "diffuse", "color"), "Base Color", False), (("metal",), "Metallic", True), (("rough",), "Roughness", True), (("emiss",), "Emission Color", False)):
            im = pick(*key)
            if im:
                t = nt.nodes.new("ShaderNodeTexImage")
                t.image = im
                if nonc:
                    im.colorspace_settings.name = "Non-Color"
                nt.links.new(t.outputs[0], b.inputs[sock])
                if sock == "Emission Color":
                    b.inputs["Emission Strength"].default_value = 1.0
        nim = pick("normal")
        if nim:
            nim.colorspace_settings.name = "Non-Color"
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = nim
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(t.outputs[0], nm.inputs["Color"])
            nt.links.new(nm.outputs[0], b.inputs["Normal"])
        log("rebuilt material", mat.name, [im.name for im in imgs][:5])
    for img in bpy.data.images:
        if img.size[0] > 1024 and img.users:
            size = 2048 if any(k in img.name.lower() for k in ("base", "albedo", "color", "diffuse", "body")) else 1024
            if img.size[0] > size:
                img.scale(size, size * img.size[1] // img.size[0])


# ── main ───────────────────────────────────────────────────────────────────
def main():
    meshes, arm = collect()
    obj, W = merge(meshes, arm)
    rigged = arm is not None and sum(1 for w in W if w) > 0.5 * len(W)
    M = normalise(obj, arm)
    W = decimate(obj, W, CFG["tris"])
    me = obj.data
    P = [b2g(v.co) for v in me.vertices]
    J = complete(landmarks_from_rig(arm, M) if arm else {}, P)
    log("rigged" if rigged else "shape-fitted", {k: tuple(round(c, 3) for c in v) for k, v in J.items()})
    if not rigged:
        W = [geo_weights(p, J) for p in P]
    else:
        W = [w if w else geo_weights(p, J) for p, w in zip(P, W)]
    chains = []
    if not rigged and CFG.get("skirt", True) and has_skirt(P):
        chains, y0 = fit_skirt(P, W, J)
        for i, p in enumerate(P):
            top = max(W[i], key=W[i].get)
            if p.y < y0 and (top == "hips" or top.startswith(("thigh", "shin"))) and (p.y < 0.45 * H or math.hypot(p.x, p.z) > 0.1 * H):
                cw = cloth_weights(p, chains, y0)
                if cw:
                    W[i] = cw
        log("skirt strands", len(chains))

    # Clear the source scene, keep our merged object and its materials.
    for o in list(bpy.data.objects):
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    BONES = {"hips": ("pelvis", "waist", None), "torso": ("waist", "neck", "hips"), "head": ("neck", "top", "torso")}
    for sd in ("L", "R"):
        BONES["upperarm_" + sd] = ("sh_" + sd, "el_" + sd, "torso")
        BONES["forearm_" + sd] = ("el_" + sd, "wr_" + sd, "upperarm_" + sd)
        BONES["hand_" + sd] = ("wr_" + sd, None, "forearm_" + sd)
        BONES["thigh_" + sd] = ("hip_" + sd, "kn_" + sd, "hips")
        BONES["shin_" + sd] = ("kn_" + sd, "an_" + sd, "thigh_" + sd)
        BONES["foot_" + sd] = ("an_" + sd, None, "shin_" + sd)
    ad = bpy.data.armatures.new("rig")
    rig = bpy.data.objects.new("rig", ad)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, par) in BONES.items():
        eb = ad.edit_bones.new(name)
        eb.head = g2b(J[h])
        eb.tail = g2b(J[t]) if t else g2b(J[h] + (J[h] - J[BONES[par][0]]).normalized() * 0.08)
        if (eb.tail - eb.head).length < 1e-3:
            eb.tail = eb.head + Vector((0, 0, 0.05))
        if par:
            eb.parent = ad.edit_bones[par]
    for ci, nodes in enumerate(chains):
        for j, n in enumerate(nodes):
            eb = ad.edit_bones.new(f"skirt_{ci}_{j}")
            eb.head = g2b(n)
            eb.tail = g2b(nodes[j + 1] if j + 1 < len(nodes) else n + Vector((0, -0.05, 0)))
            eb.parent = ad.edit_bones["hips" if j == 0 else f"skirt_{ci}_{j - 1}"]
    bpy.ops.object.mode_set(mode="OBJECT")
    names = [n for n in BONES if not n.startswith("foot")] + [f"skirt_{c}_{j}" for c in range(len(chains)) for j in range(SEGS - 1)]
    groups = {n: obj.vertex_groups.new(name=n) for n in names}
    for v, w in zip(me.vertices, W):
        w = {k: x for k, x in w.items() if k in groups}
        if not w:
            w = {"torso": 1.0}
        top4 = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in top4)
        for b, x in top4:
            groups[b].add([v.index], x / tot, "REPLACE")
    obj.parent = rig
    obj.modifiers.new("Armature", "ARMATURE").object = rig
    fix_materials(obj)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB", export_apply=False, export_skins=True, export_animations=False,
        export_image_format="WEBP", export_image_quality=85, export_cameras=False, export_lights=False,
    )
    log("exported", OUT, os.path.getsize(OUT) // 1024, "KB")


main()
