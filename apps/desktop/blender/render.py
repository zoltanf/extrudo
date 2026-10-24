"""Render Picture: Extrudo's headless Blender script (P6-15, ADR-0101 §3).

Run by the desktop app's main process (never by hand in normal use) as

    blender -b --factory-startup -noaudio --python render.py -- job.json out.png

in a directory that holds the job, the model and the script. ``job.json``:

    {"project": "Pen holder", "obj": "model.obj",
     "objects": [{"name": "Body1", "finish": "glossy", "color": "#3b82f6"}],
     "preset": "table",
     "camera": null | {"projection": "perspective", "position": [x, y, z],
                       "target": [x, y, z], "up": [x, y, z], "size": 120},
     "width": 1920, "height": 1080, "quality": "standard"}

The OBJ is in millimetres, Z up; it is imported at 1/1000 so one Blender unit
is one metre. Every object becomes a Principled material by its finish and
colour, the preset builds the scene around the model (sized to it), the camera
is the job's (millimetres, as a named view) or an automatic one along Extrudo's
home direction, and the picture is written to the output path.

The only output on stdout is ``EXTRUDO <phase>`` lines (importing, scene,
rendering, saving, done), ``EXTRUDO note <text>`` for things it worked around,
and ``EXTRUDO ERROR <one sentence>`` before exit code 2 on a failure.

A render started from a script prints no progress, so for the slow qualities
the app adds ``-f 1`` before ``--``: the script then only builds the scene and
Blender's own command-line render follows, printing ``Sample n/m`` lines as it
goes and saving ``out1.png`` next to the job (the frame number is Blender's).
Without ``-f`` the script renders itself to the given path, with the draft
quality's fallback from EEVEE to Cycles; ``"eevee": false`` in the job (the
app's second try after EEVEE crashed Blender) takes Cycles from the start.
``bpy`` only, Python 3.11+, no network, no files outside the job directory.
"""

import json
import math
import os
import sys
import traceback

import bpy
from mathutils import Matrix, Vector

PRESETS = ("studio", "table", "workbench", "outdoor")
FINISHES = ("matte", "glossy", "translucent", "resin", "metal", "wood")
QUALITIES = ("draft", "standard", "high")
DEFAULT_COLOR = "#cccccc"
HOME_DIRECTION = Vector((1.0, -1.0, 1.0)).normalized()
FOV_Y = math.radians(35.0)


def log(phase, *rest):
    print("EXTRUDO", phase, *rest, flush=True)


def fail(message):
    log("ERROR", message)
    sys.exit(2)


# ---------------------------------------------------------------- helpers


def hex_to_linear(text, fallback=DEFAULT_COLOR):
    """`#rrggbb` (sRGB) as linear RGBA for a node socket."""
    if not isinstance(text, str) or len(text) < 7 or text[0] != "#":
        text = fallback
    try:
        r, g, b = (int(text[i : i + 2], 16) / 255.0 for i in (1, 3, 5))
    except ValueError:
        r, g, b = (int(fallback[i : i + 2], 16) / 255.0 for i in (1, 3, 5))

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (lin(r), lin(g), lin(b), 1.0)


def darker(rgba, factor):
    return (rgba[0] * factor, rgba[1] * factor, rgba[2] * factor, 1.0)


def set_input(node, value, *names):
    """Sets the first of `names` the node has; a missing optional input is a note, not an error."""
    for name in names:
        if name in node.inputs:
            node.inputs[name].default_value = value
            return True
    log("note", f"no input {names[0]} on {node.bl_idname}")
    return False


def first_of(setter, *values):
    """Tries enum values in order (names differ between Blender versions)."""
    for value in values:
        try:
            setter(value)
            return value
        except TypeError:
            continue
    return None


def new_mesh_object(name, verts, faces, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def box(name, sx, sy, sz, top):
    """An axis-aligned box `sx` × `sy` × `sz` whose top face is at z = `top`, centred on x/y."""
    x, y, z0, z1 = sx / 2, sy / 2, top - sz, top
    verts = [(-x, -y, z0), (x, -y, z0), (x, y, z0), (-x, y, z0),
             (-x, -y, z1), (x, -y, z1), (x, y, z1), (-x, y, z1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return new_mesh_object(name, verts, faces)


def plane(name, size):
    h = size / 2
    return new_mesh_object(name, [(-h, -h, 0), (h, -h, 0), (h, h, 0), (-h, h, 0)], [(0, 1, 2, 3)])


def look_at(obj, location, target, up=Vector((0, 0, 1))):
    """Places `obj` at `location` looking down its -Z at `target`, `up` as its +Y."""
    forward = (Vector(target) - Vector(location)).normalized()
    right = forward.cross(Vector(up))
    if right.length < 1e-6:
        right = forward.cross(Vector((0, 1, 0)))
    right.normalize()
    true_up = right.cross(forward)
    rotation = Matrix((right, true_up, -forward)).transposed().to_4x4()
    obj.matrix_world = Matrix.Translation(Vector(location)) @ rotation


def area_light(name, location, target, energy, size, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.color = color[:3]
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    look_at(obj, location, target)
    return obj


def world_background(color, strength):
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = color
    bg.inputs["Strength"].default_value = strength
    bpy.context.scene.world = world
    return world


# ---------------------------------------------------------------- the job


def load_job(argv):
    try:
        at = argv.index("--")
    except ValueError:
        fail("The script needs '-- job.json out.png'.")
    args = argv[at + 1 :]
    if len(args) != 2:
        fail("The script needs '-- job.json out.png'.")
    try:
        with open(args[0], encoding="utf-8") as f:
            job = json.load(f)
    except (OSError, ValueError) as error:
        fail(f"The job file can't be read: {error}.")
    if job.get("preset") not in PRESETS:
        fail(f"Unknown preset {job.get('preset')!r}.")
    if job.get("quality") not in QUALITIES:
        fail(f"Unknown quality {job.get('quality')!r}.")
    for entry in job.get("objects", []):
        if entry.get("finish") not in FINISHES:
            fail(f"Unknown finish {entry.get('finish')!r}.")
    for key in ("width", "height"):
        if not isinstance(job.get(key), int) or job[key] < 1:
            fail(f"The {key} is not a positive integer.")
    # Blender resolves a relative path against the .blend file (none here): make both absolute.
    job["obj"] = os.path.abspath(job.get("obj", "model.obj"))
    return job, os.path.abspath(args[1])


def reset_scene():
    scene = bpy.context.scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    return scene


def import_model(scene, path):
    before = {obj.name for obj in bpy.data.objects}
    bpy.ops.wm.obj_import(filepath=path, global_scale=0.001, forward_axis="Y", up_axis="Z")
    imported = [obj for obj in scene.objects if obj.name not in before and obj.type == "MESH"]
    if not imported:
        fail("The model has no bodies to render.")
    # The importer keeps the scale on the object; bake it into the mesh so
    # object-space textures (the wood grain) see metres, as the scene does.
    for obj in imported:
        obj.data.transform(Matrix.Diagonal((*obj.scale, 1.0)))
        obj.scale = (1.0, 1.0, 1.0)
    return imported


def match_objects(imported, entries):
    """Each imported object with its job entry (the importer may suffix a repeated name `.001`)."""
    pairs = []
    for obj in imported:
        entry = next(
            (e for e in entries if obj.name == e.get("name") or obj.name.startswith(f"{e.get('name')}.")),
            {},
        )
        pairs.append((obj, entry))
    return pairs


def place_model(objects):
    """Moves the model so its bounding box stands on z = 0 centred on x/y; returns (offset, centre, radius, size)."""
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for obj in objects:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    if not all(math.isfinite(v) for v in (*lo, *hi)):
        fail("The model has no geometry.")
    offset = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for obj in objects:
        obj.location = obj.location + offset
    size = max(hi - lo)
    centre = Vector((0, 0, (hi.z - lo.z) / 2))
    radius = max((hi - lo).length / 2, 1e-4)
    return offset, centre, radius, size, (hi - lo) / 2


# ---------------------------------------------------------------- materials


def principled(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    return mat, bsdf


def wood_nodes(mat, bsdf, base, dark, scale, along):
    """A grain: noise stretched along one axis, a ramp from `dark` to `base`, a bump."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coords = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = tuple(
        (scale / 8 if axis == along else scale) for axis in (0, 1, 2)
    )
    noise = nodes.new("ShaderNodeTexNoise")
    set_input(noise, 6.0, "Scale")
    set_input(noise, 8.0, "Detail")
    set_input(noise, 0.3, "Distortion")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = dark
    ramp.color_ramp.elements[1].color = base
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[1].position = 0.58
    bump = nodes.new("ShaderNodeBump")
    set_input(bump, 0.08, "Strength")
    links.new(coords.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    set_input(bsdf, 0.45, "Roughness")


def finish_material(name, finish, color_hex, model_size):
    color = hex_to_linear(color_hex)
    mat, bsdf = principled(name, color)
    if finish == "matte":
        set_input(bsdf, 0.55, "Roughness")
        set_input(bsdf, 0.4, "Specular IOR Level", "Specular")
    elif finish == "glossy":
        set_input(bsdf, 0.18, "Roughness")
        set_input(bsdf, 0.5, "Coat Weight", "Clearcoat")
        set_input(bsdf, 0.05, "Coat Roughness", "Clearcoat Roughness")
    elif finish == "translucent":
        set_input(bsdf, 0.85, "Transmission Weight", "Transmission")
        set_input(bsdf, 0.25, "Roughness")
        set_input(bsdf, 1.5, "IOR")
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
    elif finish == "resin":
        set_input(bsdf, 0.08, "Roughness")
        set_input(bsdf, 0.15, "Subsurface Weight", "Subsurface")
        set_input(bsdf, (0.5, 0.3, 0.2), "Subsurface Radius")
        set_input(bsdf, 0.3, "Coat Weight", "Clearcoat")
    elif finish == "metal":
        set_input(bsdf, 1.0, "Metallic")
        set_input(bsdf, 0.35, "Roughness")
        set_input(bsdf, 0.4, "Anisotropic")
    elif finish == "wood":
        # A few grain lines across the model, whatever its size.
        wood_nodes(mat, bsdf, color, darker(color, 0.4), 0.4 / max(model_size, 0.01), 0)
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ---------------------------------------------------------------- scenes


def scene_studio(s, target):
    # A sweep: a floor wide enough that no edge is ever in the frame (the camera
    # looks down at 35° from about three model sizes away), bending up into a
    # wall through a real arc of vertices (a subdivision modifier would bulge
    # the floor up and swallow the model).
    w, back, bend, height = 100 * s, 10 * s, 2 * s, 40 * s
    profile = [(-100 * s, 0.0), (back, 0.0)]
    for k in range(1, 9):
        angle = -math.pi / 2 + (math.pi / 2) * k / 8
        profile.append((back + bend * math.cos(angle) + bend - bend, bend + bend * math.sin(angle)))
    profile.append((back + bend, height))
    verts = [(x, y, z) for y, z in profile for x in (-w, w)]
    faces = [(2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2) for k in range(len(profile) - 1)]
    sweep = new_mesh_object("Sweep", verts, faces, smooth=True)
    sweep.rotation_euler.z = math.radians(45)
    mat, bsdf = principled("Sweep", hex_to_linear("#f2f2f2"))
    set_input(bsdf, 0.7, "Roughness")
    assign(sweep, mat)
    area_light("Key", (6 * s, -6 * s, 8 * s), target, 2000 * s * s, 4 * s)
    area_light("Fill", (-7 * s, -5 * s, 4 * s), target, 400 * s * s, 6 * s)
    area_light("Rim", (-2 * s, 8 * s, 6 * s), target, 600 * s * s, 3 * s)
    world_background(hex_to_linear("#9a9a9a"), 0.3)


def scene_table(s, target):
    table = box("Table", 200 * s, 200 * s, 0.03, 0)
    base = hex_to_linear("#8b5a2b")
    mat, bsdf = principled("Table", base)
    wood_nodes(mat, bsdf, base, hex_to_linear("#5a3a1a"), 1.2 / s, 0)
    set_input(bsdf, 0.4, "Roughness")
    assign(table, mat)
    area_light("Window", (-8 * s, -6 * s, 7 * s), target, 1500 * s * s, 6 * s, (1.0, 0.945, 0.878))
    area_light("Fill", (6 * s, -4 * s, 3 * s), target, 250 * s * s, 5 * s)
    world_background(hex_to_linear("#ffe9d2"), 0.6)


# The cutting mat (owner, 2026-10-24; the app's `mat.ts`): millimetres here, metres in the scene.
MAT_COLORS = {"mat": "#1d6b52", "minor": "#4fbf9a", "major": "#8fe3c6", "text": "#b8f0dc"}
MAT_THICKNESS = 0.002
MAT_MAX_CELLS = 60


def grid_step(span):
    """10, 50, 100, 500, 1000 … mm: the first whose cells fit `span` in MAT_MAX_CELLS."""
    step = 10
    while span / step > MAT_MAX_CELLS:
        step *= 5 if str(step).startswith("1") else 2
    return step


def mat_layout(offset, extent, size):
    """The mat's grid in design millimetres, like `matLayout` (offset, extent, size in metres)."""
    ox, oy = offset.x * 1000, offset.y * 1000
    ex, ey = extent.x * 1000, extent.y * 1000
    margin = max(15, 0.25 * size * 1000)
    lo_x, lo_y = -ex - ox - margin, -ey - oy - margin
    hi_x, hi_y = ex - ox + margin, ey - oy + margin
    step = grid_step(max(hi_x - lo_x, hi_y - lo_y))
    x0, x1 = math.floor(lo_x / step) * step, math.ceil(hi_x / step) * step
    y0, y1 = math.floor(lo_y / step) * step, math.ceil(hi_y / step) * step
    span = max(x1 - x0, y1 - y0)
    return {
        "x0": x0, "x1": x1, "y0": y0, "y1": y1,
        "border": max(12, span / 25), "step": step, "major": step * 5,
        "label": step if span / step <= 30 else step * 5, "dx": ox, "dy": oy,
    }


def mat_number(mm):
    value = round(mm)
    return f"\u2212{-value}" if value < 0 else f"{value}"


def grid_mask(nodes, links, coord, step, half_width, lo, hi):
    """1 on a line every `step` mm along `coord` (mm) within [lo, hi], else 0."""
    def math_node(op, a, b=None):
        node = nodes.new("ShaderNodeMath")
        node.operation = op
        for index, value in enumerate((a, b)):
            if value is None:
                continue
            if isinstance(value, (int, float)):
                node.inputs[index].default_value = value
            else:
                links.new(value, node.inputs[index])
        return node.outputs[0]

    wrap = nodes.new("ShaderNodeMath")
    wrap.operation = "WRAP"
    links.new(math_node("ADD", coord, step / 2), wrap.inputs[0])
    wrap.inputs[1].default_value = step
    wrap.inputs[2].default_value = 0.0
    distance = math_node("ABSOLUTE", math_node("SUBTRACT", wrap.outputs[0], step / 2))
    on_line = math_node("LESS_THAN", distance, half_width)
    inside = math_node(
        "MULTIPLY",
        math_node("GREATER_THAN", coord, lo - half_width),
        math_node("LESS_THAN", coord, hi + half_width),
    )
    return math_node("MULTIPLY", on_line, inside), inside


def mat_material(layout):
    """The grid as shader maths on the mat's world position (no image): design mm = (P - offset) · 1000."""
    mat, bsdf = principled("Cutting mat", hex_to_linear(MAT_COLORS["mat"]))
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    geometry = nodes.new("ShaderNodeNewGeometry")
    xyz = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geometry.outputs["Position"], xyz.inputs[0])

    def design(axis, shift):
        node = nodes.new("ShaderNodeMath")
        node.operation = "MULTIPLY_ADD"
        links.new(xyz.outputs[axis], node.inputs[0])
        node.inputs[1].default_value = 1000.0
        node.inputs[2].default_value = -shift
        return node.outputs[0]

    x, y = design("X", layout["dx"]), design("Y", layout["dy"])
    step, major = layout["step"], layout["major"]
    lines = {}
    for name, every, half in (("minor", step, step * 0.0125), ("major", major, step * 0.025)):
        mx, inside_x = grid_mask(nodes, links, x, every, half, layout["x0"], layout["x1"])
        my, inside_y = grid_mask(nodes, links, y, every, half, layout["y0"], layout["y1"])
        # A line along one axis shows only where the other axis is inside the grid.
        across = nodes.new("ShaderNodeMath")
        across.operation = "MAXIMUM"
        for a, b, i in ((mx, inside_y, 0), (my, inside_x, 1)):
            both = nodes.new("ShaderNodeMath")
            both.operation = "MULTIPLY"
            links.new(a, both.inputs[0])
            links.new(b, both.inputs[1])
            links.new(both.outputs[0], across.inputs[i])
        lines[name] = across.outputs[0]
    color = bsdf.inputs["Base Color"].default_value[:]
    for name in ("minor", "major"):
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        links.new(lines[name], mix.inputs["Factor"])
        if isinstance(color, tuple):
            mix.inputs["A"].default_value = color
        else:
            links.new(color, mix.inputs["A"])
        mix.inputs["B"].default_value = hex_to_linear(MAT_COLORS[name])
        color = mix.outputs["Result"]
    links.new(color, bsdf.inputs["Base Color"])
    set_input(bsdf, 0.75, "Roughness")
    return mat


def mat_numbers(layout):
    """The numbers in the border: along the front edge (x) and the right edge (y), facing the camera."""
    text = principled("Mat numbers", hex_to_linear(MAT_COLORS["text"]))[0]
    size = min(layout["border"] * 0.5, layout["label"] * 0.38) / 1000
    b, label = layout["border"], layout["label"]

    def place(mm, at_x, at_y, turn):
        curve = bpy.data.curves.new(f"Mat {mm}", "FONT")
        curve.body = mat_number(mm)
        curve.size = size
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        obj = bpy.data.objects.new(curve.name, curve)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = ((at_x + layout["dx"]) / 1000, (at_y + layout["dy"]) / 1000, 0.00005)
        obj.rotation_euler = (0, 0, turn)
        obj.data.materials.append(text)

    value = math.ceil(layout["x0"] / label) * label
    while value <= layout["x1"] + 1e-6:
        place(value, value, layout["y0"] - b / 2, 0)
        value += label
    value = math.ceil(layout["y0"] / label) * label
    while value <= layout["y1"] + 1e-6:
        place(value, layout["x1"] + b / 2, value, math.pi / 2)
        value += label


def cutting_mat(placed):
    offset, extent, size = placed
    layout = mat_layout(offset, extent, size)
    b = layout["border"]
    x0, x1, y0, y1 = layout["x0"] - b, layout["x1"] + b, layout["y0"] - b, layout["y1"] + b
    mat = box("Cutting mat", (x1 - x0) / 1000, (y1 - y0) / 1000, MAT_THICKNESS, 0)
    mat.location = ((x0 + x1) / 2000 + layout["dx"] / 1000, (y0 + y1) / 2000 + layout["dy"] / 1000, 0)
    assign(mat, mat_material(layout))
    mat_numbers(layout)
    return layout


def scene_workbench(s, target, placed):
    # The dark worktop under the cutting mat (its top at the mat's underside).
    top = box("Worktop", 200 * s, 200 * s, 0.04, -MAT_THICKNESS)
    mat, bsdf = principled("Worktop", hex_to_linear("#2e2e32"))
    set_input(bsdf, 0.6, "Roughness")
    assign(top, mat)
    cutting_mat(placed)
    area_light("Key", (5 * s, -7 * s, 8 * s), target, 1000 * s * s, 4 * s, (0.894, 0.925, 1.0))
    area_light("Rim", (-4 * s, 7 * s, 5 * s), target, 1400 * s * s, 3 * s)
    world_background(hex_to_linear("#404048"), 0.4)


def scene_outdoor(s, target):
    ground = plane("Ground", 400 * s)
    mat, bsdf = principled("Ground", hex_to_linear("#6b7a5a"))
    set_input(bsdf, 0.9, "Roughness")
    assign(ground, mat)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    sky = nodes.new("ShaderNodeTexSky")
    if first_of(lambda v: setattr(sky, "sky_type", v), "MULTIPLE_SCATTERING", "NISHITA") is None:
        log("note", "no Nishita sky; keeping the default sky")
    elevation, rotation = math.radians(40), math.radians(300)
    if hasattr(sky, "sun_disc"):
        sky.sun_disc = False  # the Sun lamp below casts the shadows
    sky.sun_elevation = elevation
    sky.sun_rotation = rotation
    for name, value in (("sun_intensity", 0.5), ("air_density", 1.0), ("dust_density", 1.0)):
        if hasattr(sky, name):
            setattr(sky, name, value)
    links.new(sky.outputs["Color"], nodes["Background"].inputs["Color"])
    # The physical sky is bright: keep it a fill, the Sun lamp gives the light and shadows.
    nodes["Background"].inputs["Strength"].default_value = 0.05
    bpy.context.scene.world = world
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 6.0
    sun.angle = math.radians(1.0)
    obj = bpy.data.objects.new("Sun", sun)
    bpy.context.scene.collection.objects.link(obj)
    # The sky's sun sits at `elevation` above the horizon, `rotation` around Z.
    direction = Vector((-math.sin(rotation) * math.cos(elevation),
                        -math.cos(rotation) * math.cos(elevation), math.sin(elevation)))
    look_at(obj, Vector(target) + direction * 10 * s, target)


SCENES = {"studio": scene_studio, "table": scene_table, "workbench": scene_workbench,
          "outdoor": scene_outdoor}


# ---------------------------------------------------------------- camera and render


def fit_distance(centre, extent, direction, aspect):
    """How far back along `direction` the camera sits so every corner of the box
    (centre ± extent) is inside the view with a 10% margin."""
    forward = -direction
    right = forward.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(forward)
    tan_y = math.tan(FOV_Y / 2)
    tan_x = aspect * tan_y
    distance = 0.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                q = Vector((sx * extent.x, sy * extent.y, sz * extent.z))
                need = max(abs(q.dot(right)) / tan_x, abs(q.dot(up)) / tan_y) * 1.1 + q.dot(direction)
                distance = max(distance, need)
    return max(distance, 1e-3)


def setup_camera(scene, job_camera, aspect, offset, centre, radius, extent):
    data = bpy.data.cameras.new("Camera")
    data.sensor_fit = "VERTICAL"
    data.angle_y = FOV_Y
    data.clip_start = max(radius / 100, 1e-4)
    data.clip_end = radius * 100 + 100
    cam = bpy.data.objects.new("Camera", data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    if job_camera:
        mm = lambda v: Vector(v) * 0.001 + offset  # noqa: E731
        position, target, up = mm(job_camera["position"]), mm(job_camera["target"]), Vector(job_camera["up"])
        look_at(cam, position, target, up)
        if job_camera.get("projection") == "orthographic":
            data.type = "ORTHO"
            data.ortho_scale = float(job_camera.get("size") or (2 * radius * 1000)) * 0.001
        return
    distance = fit_distance(centre, extent, HOME_DIRECTION, aspect)
    look_at(cam, centre + HOME_DIRECTION * distance, centre)


def pick_cycles_device(scene):
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.get_devices()
        for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
            devices = [d for d in prefs.devices if d.type == kind]
            if not devices:
                continue
            prefs.compute_device_type = kind
            for device in prefs.devices:
                device.use = device.type in (kind, "CPU")
            scene.cycles.device = "GPU"
            log("note", f"cycles on {kind}")
            return
    except Exception as error:  # noqa: BLE001
        log("note", f"cycles device: {error}")
    scene.cycles.device = "CPU"


def use_cycles(scene, samples):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    pick_cycles_device(scene)


def use_eevee(scene, samples):
    chosen = first_of(lambda v: setattr(scene.render, "engine", v), "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE")
    if chosen is None:
        raise RuntimeError("no EEVEE engine")
    scene.eevee.taa_render_samples = samples
    if hasattr(scene.eevee, "use_raytracing"):
        scene.eevee.use_raytracing = True


def setup_render(scene, job, out):
    render = scene.render
    render.resolution_x, render.resolution_y = job["width"], job["height"]
    render.resolution_percentage = 100
    render.image_settings.file_format = "PNG"
    render.image_settings.color_mode = "RGB"
    render.film_transparent = False
    render.filepath = out
    if first_of(lambda v: setattr(scene.view_settings, "view_transform", v), "AgX", "Filmic") is None:
        log("note", "neither AgX nor Filmic; keeping the default view transform")
    first_of(lambda v: setattr(scene.view_settings, "look", v), "None")
    quality = job["quality"]
    if quality == "draft" and not job.get("eevee", True):
        # The app's second try after EEVEE crashed Blender (no usable GPU).
        log("note", "eevee skipped; using Cycles")
        use_cycles(scene, 32)
    elif quality == "draft":
        try:
            use_eevee(scene, 16)
        except Exception as error:  # noqa: BLE001
            log("note", f"eevee unavailable ({error}); using Cycles")
            use_cycles(scene, 32)
    else:
        use_cycles(scene, 128 if quality == "standard" else 512)


def render_still(scene, job):
    try:
        bpy.ops.render.render(write_still=True)
    except Exception as error:  # noqa: BLE001
        if job["quality"] == "draft" and scene.render.engine != "CYCLES":
            log("note", f"eevee render failed ({error}); using Cycles")
            use_cycles(scene, 32)
            bpy.ops.render.render(write_still=True)
        else:
            raise


# ---------------------------------------------------------------- main


def main():
    job, out = load_job(sys.argv)
    log("importing")
    scene = reset_scene()
    imported = import_model(scene, job["obj"])
    offset, centre, radius, size, extent = place_model(imported)
    s = max(size, 0.05)
    for index, (obj, entry) in enumerate(match_objects(imported, job.get("objects", []))):
        finish = entry.get("finish", "matte")
        assign(obj, finish_material(f"Body{index + 1}", finish, entry.get("color"), size))
    log("scene")
    preset = job["preset"]
    if preset == "workbench":
        scene_workbench(s, centre, (offset, extent, size))
    else:
        SCENES[preset](s, centre)
    setup_camera(
        scene, job.get("camera"), job["width"] / job["height"], offset, centre, radius, extent
    )
    setup_render(scene, job, out)
    if "-f" in sys.argv:
        # Blender renders after this script (`-f 1`): the frame number lands in
        # the name, so `out.png` becomes `out1.png`.
        scene.render.filepath = f"{os.path.splitext(out)[0]}#"
        log("rendering")
        return
    log("rendering")
    render_still(scene, job)
    log("saving")
    log("done")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        fail(f"{type(error).__name__}: {error}")
