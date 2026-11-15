"""Illustrate temporary drip containment in a residential interior."""
import sys
from math import cos, pi, sin
from pathlib import Path
from random import Random

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from guide_scene import camera, cube, light, line, material, mesh, render, setup


output, *options = sys.argv[sys.argv.index("--") + 1:]
aid = options[0] if options else "bucket"
scene = setup()
plaster = material("Warm painted plaster", (0.74, 0.68, 0.58), 0.82,
                   texture=(120, (1, 1, 1), 0.23, 0.0013, 0.95))
ceiling = material("White ceiling paint", (0.87, 0.86, 0.80), 0.89,
                   texture=(145, (1, 1, 1), 0.19, 0.0014, 0.95))
oak = [material("Floor oak", (g, g * 0.60, g * 0.33), 0.48,
                texture=(11, (1, 13, 1), 0.27, 0.008, 0.48))
       for g in (0.34, 0.39, 0.43, 0.47, 0.50, 0.54)]
trim = material("Satin white baseboard", (0.83, 0.82, 0.75), 0.35)
plastic = material("Injection molded blue bucket", (0.025, 0.21, 0.255), 0.24,
                   texture=(45, (1, 1, 1), 0.11, 0.001, 0.88))
chrome = material("Galvanized steel handle", (0.41, 0.45, 0.48), 0.25, metallic=0.8)
cloth = material("Terry cloth towel", (0.57, 0.67, 0.69), 0.92,
                 texture=(90, (1, 1, 1), 0.7, 0.012, 0.69))
hem = material("Towel binding", (0.41, 0.52, 0.53), 0.88)
water = material("Water reflecting the window", (0.92, 0.98, 1.0), 0.045)
shader = water.node_tree.nodes.get("Principled BSDF")
shader.inputs["IOR"].default_value = 1.333
(shader.inputs.get("Transmission Weight") or shader.inputs["Transmission"]).default_value = 0.87

# The window interrupts the back wall so the area light casts natural interior shadows.
window_left, window_right = 0.16, 1.55
window_bottom, window_top = 0.88, 2.04
wall_back = 1.08
window_center = (window_left + window_right) / 2
window_width = window_right - window_left
wall = cube("Continuous painted wall", (0, wall_back, 1.17), (8, 0.17, 2.34), plaster, 0)
opening = cube("Window opening", (window_center, wall_back, (window_bottom + window_top) / 2),
               (window_width, 0.38, window_top - window_bottom), plaster, 0)
cut = wall.modifiers.new("Window opening", "BOOLEAN")
cut.operation = "DIFFERENCE"
cut.object = opening
bpy.context.view_layer.objects.active = wall
bpy.ops.object.modifier_apply(modifier=cut.name)
bpy.data.objects.remove(opening, do_unlink=True)
cube("Room wall", (-3.95, -1.63, 1.17), (0.15, 5.41, 2.34), plaster)
cube("Ceiling", (0, -0.66, 2.39), (8, 3.62, 0.12), ceiling)
cube("Baseboard", (0, 0.982, 0.05), (8, 0.028, 0.10), trim)
cube("Quarter round below the baseboard", (0, 0.966, 0.009), (8, 0.015, 0.017), trim, 0.004)
for row in range(36):
    y = 0.94 - row * 0.166
    joints = [-4, -2.70 + row % 4 * 0.27, -0.61 + row % 3 * 0.31, 1.62 + row % 5 * 0.12, 4]
    for piece, (left, right) in enumerate(zip(joints, joints[1:])):
        cube("Staggered oak floorboard", ((left + right) / 2, y, -0.009),
             (right - left - 0.002, 0.164, 0.018), oak[(row * 5 + piece * 3) % len(oak)], 0.001)

for x_border in (window_left, window_center, window_right):
    cube("Painted vertical window frame", (x_border, 1.03, (window_bottom + window_top) / 2),
         (0.049 if x_border == window_center else 0.075, 0.14, window_top - window_bottom), trim)
for z_border in (window_bottom, (window_bottom + window_top) / 2, window_top):
    cube("Painted horizontal window frame", (window_center, 1.029, z_border),
         (window_width, 0.14, 0.047), trim)
cube("Wooden sill", (window_center, 0.96, window_bottom - 0.025),
     (window_width + 0.16, 0.26, 0.044), trim)

# Plain exterior plaster and a warm window reveal, seen through the opening.
exterior = material("Exterior stucco", (0.66, 0.70, 0.64), 0.87,
                    texture=(21, (1, 1, 1), 0.39, 0.012, 0.81))
cube("Exterior courtyard wall", (-1.35, 4.9, 0.83), (14, 0.15, 1.97), exterior)
# Tiny leaf faces keep the view outside a quiet backdrop to the repair.
leaf_finishes = [material("Courtyard leaves", (v * 0.64, v, v * 0.39), 0.75)
                 for v in (0.20, 0.27, 0.34, 0.43)]
rng = Random(49)
leaves, facets = [], []
for i in range(980):
    angle = rng.uniform(0, 2 * pi)
    radius = rng.uniform(0, 1) ** 0.5
    x = -0.09 + radius * 0.73 * cos(angle)
    y = 3.94 + radius * 0.46 * sin(angle)
    z = 0.50 + rng.uniform(0, 0.98) * (0.62 + (1 - radius) * 0.72)
    heading = rng.uniform(0, 2 * pi)
    dx, dz = 0.023 * cos(heading), 0.028 * sin(heading)
    start = len(leaves)
    leaves += [(x - dx, y, z - dz), (x - dz * 0.29, y - 0.009, z + dx * 0.41),
               (x + dx, y + 0.012, z + dz), (x + dz * 0.30, y + 0.006, z - dx * 0.40)]
    facets.append(tuple(range(start, start + 4)))
shrub = mesh("Leaves above the courtyard wall", leaves, facets, leaf_finishes[0])
for finish in leaf_finishes[1:]:
    shrub.data.materials.append(finish)
for face in shrub.data.polygons:
    face.material_index = rng.randrange(len(leaf_finishes))

if aid == "bucket":
    # Feathered ceiling stain above the drip, sunk against the painted surface.
    stain = bpy.data.materials.new("Water stain with soft tide marks")
    stain.use_nodes = True
    nodes, links = stain.node_tree.nodes, stain.node_tree.links
    base = nodes.get("Principled BSDF")
    base.inputs["Base Color"].default_value = (0.29, 0.153, 0.063, 1)
    base.inputs["Roughness"].default_value = 0.73
    mix = nodes.new("ShaderNodeMixShader")
    clear = nodes.new("ShaderNodeBsdfTransparent")
    mask = nodes.new("ShaderNodeVertexColor")
    mask.layer_name = "Dampness"
    links.new(mask.outputs["Alpha"], mix.inputs[0])
    links.new(clear.outputs[0], mix.inputs[1])
    links.new(base.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes.get("Material Output").inputs["Surface"])
    rings = (0.0, 0.25, 0.51, 0.74, 0.88, 1.0)
    opacity = (0.54, 0.33, 0.21, 0.43, 0.17, 0.0)
    segments = 64
    points = []
    for radius in rings:
        for i in range(segments):
            t = 2 * pi * i / segments
            edge = 1 + 0.13 * sin(4 * t + 2) + 0.08 * cos(7 * t)
            points.append((-0.37 + cos(t) * 0.35 * radius * edge,
                           0.20 + sin(t) * 0.26 * radius * edge, 2.328))
    faces = [(k * segments + i, k * segments + (i + 1) % segments,
              (k + 1) * segments + (i + 1) % segments, (k + 1) * segments + i)
             for k in range(len(rings) - 1) for i in range(segments)]
    patch = mesh("Water stain on ceiling paint", points, faces, stain)
    colors = patch.data.color_attributes.new(name="Dampness", type="FLOAT_COLOR", domain="POINT")
    for i, entry in enumerate(colors.data):
        entry.color = (1, 1, 1, opacity[(i % len(points)) // segments])

x, y = -0.37, 0.20
angles = [i * 2 * pi / 96 for i in range(96)]
if aid == "bucket":
    profile = [(0, 0.015), (0.115, 0.015), (0.125, 0.023), (0.169, 0.268),
               (0.178, 0.272), (0.179, 0.283), (0.172, 0.29), (0.160, 0.29),
               (0.157, 0.278), (0.114, 0.036), (0, 0.036)]
    vertices = [(x + radius * cos(t), y + radius * sin(t), z) for radius, z in profile for t in angles]
    faces = [(j * 96 + i, j * 96 + (i + 1) % 96, (j + 1) * 96 + (i + 1) % 96, (j + 1) * 96 + i)
             for j in range(len(profile) - 1) for i in range(96)]
    bucket = mesh("Hollow bucket with thick rolled rim", vertices, faces, plastic)
    for polygon in bucket.data.polygons:
        polygon.use_smooth = True
    line("Bucket bail handle", [(x + 0.174 * cos(t), y - 0.17 * sin(t), 0.253 - 0.13 * sin(t))
                               for t in [i * pi / 48 for i in range(49)]], 0.0038, chrome)
    for side in (-1, 1):
        cube("Bail handle attachment", (x + side * 0.168, y, 0.253), (0.021, 0.049, 0.045), plastic)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.145, depth=0.009, location=(x, y, 0.213))
    bpy.context.object.name = "Water caught in bucket"
    bpy.context.object.data.materials.append(water)
    for radius in (0.032, 0.063, 0.091):
        line("Ripple at impact", [(x + radius * cos(t), y + radius * sin(t), 0.218)
                                  for t in [i * pi / 48 for i in range(97)]], 0.001, water)

# The single-towel guide leaves the bucket out and depicts a small spill on the floor.
towels = [((x - 0.24, y - 0.04), -0.23, 0.25, 0.53)]
if aid == "bucket":
    towels.append(((x + 0.16, y - 0.22), 0.29, 0.42, 0.22))
for anchor, theta, width, length in towels:
    n = 26
    def point(i, j):
        u, v = i / n, j / n
        a, b = (u - 0.5) * width, (v - 0.5) * length
        a += 0.007 * sin(v * 19 + u * 2)
        b += 0.005 * cos(u * 13 + v * 2)
        z = 0.012 + 0.004 * sin(u * 24 + v * 3) + 0.002 * sin(v * 21)
        return (anchor[0] + a * cos(theta) - b * sin(theta),
                anchor[1] + a * sin(theta) + b * cos(theta), z)
    verts = [point(i, j) for i in range(n + 1) for j in range(n + 1)]
    quads = [(i * (n + 1) + j, (i + 1) * (n + 1) + j, (i + 1) * (n + 1) + j + 1, i * (n + 1) + j + 1)
             for i in range(n) for j in range(n)]
    obj = mesh("Terry towel with soft wrinkles", verts, quads, cloth)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.modifiers.new("Cotton thickness", "SOLIDIFY").thickness = 0.004
    line("Bound edges on the towel", [point(i, 0) for i in range(n + 1)] + [point(n, j) for j in range(1, n + 1)]
         + [point(i, n) for i in range(n - 1, -1, -1)] + [point(0, j) for j in range(n - 1, -1, -1)], 0.0024, hem)

if aid == "bucket":
    for i in range(5):
        angle = -0.7 + 2.4 * i
        distance = 0.014 + 0.010 * i
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.0035 + (i % 2) * 0.002,
                                           location=(x + cos(angle) * distance, y + sin(angle) * distance, 0.224 + 0.011 * i))
        bpy.context.object.name = "Splash over the water surface"
        bpy.context.object.data.materials.append(water)

if aid == "bucket":
    for i, (z, radius) in enumerate(((2.315, 0.010), (2.08, 0.006), (1.75, 0.005), (1.32, 0.007),
                                         (0.77, 0.007), (0.49, 0.006), (0.245, 0.005))):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=radius,
                                           location=(x + 0.005 * sin(i * 2), y, z))
        obj = bpy.context.object
        obj.name = "Falling water droplet"
        obj.scale.z = 1.45
        obj.data.materials.append(water)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
else:
    puddle_edge = [(x + .18 * cos(t) * (1 + .12 * sin(t * 5)), y + .12 * sin(t),
                    .002) for t in angles]
    mesh("Thin spill beside the towel", puddle_edge, [tuple(range(len(angles)))], water)

light("Daylight through the window", (window_center, 2.07, 1.93), (-0.3, -1.4, 0.35),
      430, 1.4, (1, 0.91, 0.79))
light("A patch of direct sunlight through the window", (1.9, 3.0, 3.48), (-0.42, 0.04, 0.01),
      180, 0.42, (1, 0.88, 0.72))
light("Soft reflected light from the room", (1.2, -2.7, 2.03), (-0.55, 0.3, 0.88),
      190, 2.4, (0.92, 0.95, 1.0))
light("Sunlight reaching the courtyard", (0.4, 3.1, 3.8), (0.09, 3.8, 1.27),
      180, 2, (1, 0.87, 0.73))
camera(scene, (1.92, -3.62, 1.47), (-0.16, 0.49, 1.12), 41)
render(scene, output, 1200, 1008)
