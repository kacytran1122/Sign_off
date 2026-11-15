"""Illustrate temporary drip containment in a residential interior."""
import sys
from math import cos, pi, sin

sys.path.insert(0, "/opt/fix-this-spot-blender")
import bpy
from mathutils import Matrix, Vector
from guide_scene import camera, caption, cube, editorial_ink, light, line, material, mesh, render, setup


scene = setup()
plaster = material("Warm painted plaster", (0.74, 0.68, 0.58), 0.82,
                   texture=(120, (1, 1, 1), 0.25, 0.006, 0.83))
ceiling = material("White ceiling paint", (0.87, 0.86, 0.80), 0.89,
                   texture=(145, (1, 1, 1), 0.22, 0.006, 0.88))
oak = [material("Floor oak", (g, g * 0.60, g * 0.33), 0.48,
                texture=(11, (1, 13, 1), 0.27, 0.008, 0.48))
       for g in (0.34, 0.39, 0.43, 0.47, 0.50, 0.54)]
trim = material("Satin white baseboard", (0.83, 0.82, 0.75), 0.35)
stage = material("Stone gray background", (0.59, 0.64, 0.65), 0.9)
dark = material("Exposed cut edge", (0.19, 0.19, 0.16))
plastic = material("Injection molded blue bucket", (0.026, 0.24, 0.32), 0.27)
chrome = material("Galvanized steel handle", (0.41, 0.45, 0.48), 0.25, metallic=0.8)
cloth = material("Terry cloth towel", (0.57, 0.67, 0.69), 0.92,
                 texture=(90, (1, 1, 1), 0.7, 0.012, 0.69))
hem = material("Towel binding", (0.41, 0.52, 0.53), 0.88)
water = material("Water reflecting the window", (0.65, 0.86, 0.93), 0.072)
shader = water.node_tree.nodes.get("Principled BSDF")
shader.inputs["IOR"].default_value = 1.333
(shader.inputs.get("Transmission Weight") or shader.inputs["Transmission"]).default_value = 0.87

cube("Studio ground", (0, 0, -0.17), (200, 200, 0.12), stage, 0)
cube("Sectioned subfloor", (0, 0.09, -0.058), (2.27, 1.83, 0.105), dark)
for row in range(11):
    y = -0.74 + row * 0.165
    seam = (-0.62, -0.17, 0.26, 0.62)[row % 4]
    for piece, (left, right) in enumerate(((-1.13, seam), (seam, 1.13))):
        cube("Staggered oak floorboard", ((left + right) / 2, y, -0.009),
             (right - left - 0.003, 0.162, 0.018), oak[(row * 5 + piece * 3) % len(oak)], 0.001)
cube("Back wall", (0, 1.01, 1.16), (2.27, 0.12, 2.34), plaster)
cube("Baseboard", (0, 0.94, 0.062), (2.26, 0.023, 0.122), trim)
cube("Partial ceiling", (-0.18, 0.64, 2.33), (1.91, 0.84, 0.10), ceiling)
cube("Ceiling cut edge", (-0.18, 0.22, 2.355), (1.91, 0.012, 0.04), trim, 0.001)

# Feathered, irregular damp patch at the open edge, with the actual drip below it.
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
                       0.213 - 0.002 + max(0, sin(t) * 0.22 * radius * edge), 2.278))
faces = [(k * segments + i, k * segments + (i + 1) % segments,
          (k + 1) * segments + (i + 1) % segments, (k + 1) * segments + i)
         for k in range(len(rings) - 1) for i in range(segments)]
rim_points = [(px, 0.213, 2.281 + (py - 0.211) * 0.32)
              for px, py, _ in points]
patch = mesh("Feathered water stain on ceiling underside", points + rim_points,
             faces + [tuple(i + len(points) for i in face) for face in faces], stain)
colors = patch.data.color_attributes.new(name="Dampness", type="FLOAT_COLOR", domain="POINT")
for i, entry in enumerate(colors.data):
    entry.color = (1, 1, 1, opacity[(i % len(points)) // segments])

x, y = -0.37, 0.20
before_detail = set(scene.objects)
profile = [(0, 0.015), (0.115, 0.015), (0.125, 0.023), (0.169, 0.268),
           (0.178, 0.272), (0.179, 0.283), (0.172, 0.29), (0.160, 0.29),
           (0.157, 0.278), (0.114, 0.036), (0, 0.036)]
angles = [i * 2 * pi / 96 for i in range(96)]
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

# Two towels lie flat beside the bucket. Their hems and folds stay visible.
for anchor, theta, width, length in [((x - 0.24, y - 0.04), -0.23, 0.25, 0.53),
                                     ((x + 0.16, y - 0.22), 0.29, 0.42, 0.22)]:
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

for i in range(5):
    angle = -0.7 + 2.4 * i
    distance = 0.014 + 0.010 * i
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.0035 + (i % 2) * 0.002,
                                       location=(x + cos(angle) * distance, y + sin(angle) * distance, 0.224 + 0.011 * i))
    bpy.context.object.name = "Splash over the water surface"
    bpy.context.object.data.materials.append(water)
detail = set(scene.objects) - before_detail

for i, (z, radius) in enumerate(((2.26, 0.013), (2.06, 0.009), (1.75, 0.009), (1.32, 0.009),
                                 (0.77, 0.009), (0.49, 0.008), (0.245, 0.007))):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=radius,
                                       location=(x + 0.005 * sin(i * 2), y, z))
    obj = bpy.context.object
    obj.name = "Falling water droplet"
    obj.scale.z = 1.45
    obj.data.materials.append(water)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True

# A second, larger view shows how the towels sit alongside the bucket.
bpy.context.view_layer.update()
pivot = Vector((x, y, 0))
close_center = Vector((2.47, 0.17, 0.008))
transform = Matrix.Translation(close_center) @ Matrix.Scale(2.6, 4) @ Matrix.Translation(-pivot)
for original in sorted(detail, key=lambda obj: obj.name):
    copy = original.copy()
    scene.collection.objects.link(copy)
    copy.matrix_world = transform @ original.matrix_world
cube("Close-up floor section beneath the same setup", (2.45, 0.11, -0.058),
     (2.2, 1.68, 0.122), dark)
for row in range(10):
    cube("Close-up oak floorboard", (2.45, -0.64 + row * 0.165, -0.004),
         (2.195, 0.162, 0.019), oak[(row * 5) % len(oak)], 0.001)

light("Window light", (-2, -3, 3.6), (0, 0, 0.9), 480, 3, (1, 0.88, 0.74))
light("Reflected window light", (4.8, -1.8, 3.4), (2.2, 0, 0.4), 420, 3.4, (0.83, 0.92, 1))
light("Ceiling bounce", (1.5, 1.5, 3.9), (x, y, 1.2), 155, 2.1, (1, 0.96, 0.87))
view = camera(scene, (3.15, -8.3, 3.52), (1.16, 0.05, 1.23), 5.52)
ink = editorial_ink()
caption(view, "A small ceiling drip", -2.46, 1.87, 0.225, ink)
caption(view, "TEMPORARY WATER CONTAINMENT", -2.45, 1.69, 0.095, ink)
caption(view, "BUCKET + TOWELS", 0.44, 0.64, 0.145, ink)
caption(view, "Bucket catches drips.\nTowels absorb splashes.", 0.45, 0.42, 0.120, ink)
caption(view, "REPAIR  /  Stop the source, then dry and assess the ceiling before restoring it.", -2.46, -1.80, 0.103, ink)
caption(view, "Keep clear if the ceiling sags or the water is near electrical fixtures.", -2.46, -1.98, 0.099, ink)
render(scene, sys.argv[sys.argv.index("--") + 1], 1536, 1220)
