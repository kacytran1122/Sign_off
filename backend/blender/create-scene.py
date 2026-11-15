import sys

import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, roughness=0.65):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    return mat


def cube(name, location, size, mat, bevel=0.05):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Rounded edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    return obj


def area_light(name, location, power, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat("-Z", "Y").to_euler()


base = material("Midnight backdrop", (0.028, 0.049, 0.072))
wall = material("Pale concrete", (0.55, 0.68, 0.70))
slate = material("Warehouse floor", (0.11, 0.22, 0.27))
teal = material("Lobby floor", (0.07, 0.40, 0.37))
roof = material("Roof slab", (0.24, 0.39, 0.43))
gold = material("Amber inspection area", (0.95, 0.50, 0.08))
aqua = material("Blue ceiling marker", (0.03, 0.62, 0.98))

cube("Backdrop", (0, 0, -0.22), (200, 200, 0.2), base)
cube("Building base", (0, 0.43, 0.0), (7.0, 3.45, 0.24), wall, 0.09)
cube("Lobby", (-2.13, 0.43, 0.15), (2.58, 3.28, 0.13), teal)
cube("Warehouse", (1.33, 0.43, 0.15), (4.10, 3.28, 0.13), slate)
cube("Back wall", (0, 2.1, 0.65), (7, 0.14, 1.25), wall)
cube("Side wall", (-3.43, 0.44, 0.64), (0.14, 3.4, 1.22), wall)
cube("Partition", (-0.79, 0.7, 0.50), (0.12, 2.6, 0.85), wall)
cube("Suspended roof section", (0, 0.80, 2.52), (7.0, 2.66, 0.24), roof, 0.09)
for x in (-3.1, 3.1):
    cube(f"Roof edge {x}", (x, 0.8, 2.66), (0.10, 2.5, 0.05), wall)
for x in (-2.9, 2.9):
    cube(f"Roof fixture {x}", (x, 1.65, 2.83), (0.48, 0.44, 0.33), wall)

cube("Inspection patch", (-2.02, 0.23, 2.66), (1.27, 1.25, 0.10), gold, 0.07)
cube("Vertical guide", (-2.02, 0.23, 1.98), (0.034, 0.034, 1.32), gold, 0.01)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.20, location=(-2.02, 0.23, 1.26))
marker = bpy.context.object
marker.name = "Report marker"
marker.scale.z = 1.32
marker.data.materials.append(aqua)
for face in marker.data.polygons:
    face.use_smooth = True

world = bpy.data.worlds.new("Studio world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.48, 0.60, 0.78, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.30
scene.world = world
area_light("Key", (0, -4, 8), 1500, 6, (1.0, 0.87, 0.74))
area_light("Fill", (5, 0, 4), 750, 4, (0.52, 0.76, 1.0))
area_light("Rim", (-3, 5, 6), 1250, 5, (0.66, 0.85, 1.0))

camera_data = bpy.data.cameras.new("Isometric camera")
camera = bpy.data.objects.new("Isometric camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (7, -11.5, 8.3)
target = Vector((0, 0, 1.25))
camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 10.9
scene.camera = camera

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 40
scene.cycles.use_denoising = False
scene.render.resolution_x = 960
scene.render.resolution_y = 660
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"

output = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.save_as_mainfile(filepath=output)
