"""Shared geometry, materials, and lighting for the tenant repair guides."""
import bpy
from mathutils import Vector


def material(name, color, roughness=0.5, *, texture=None, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if texture:
        scale, stretch, strength, distance, tint = texture
        coords = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeVectorMath")
        mapping.operation = "MULTIPLY"
        mapping.inputs[1].default_value = stretch
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = scale
        noise.inputs["Detail"].default_value = 3
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.18
        ramp.color_ramp.elements[0].color = (*(v * tint for v in color), 1)
        ramp.color_ramp.elements[1].position = 0.85
        ramp.color_ramp.elements[1].color = (*color, 1)
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = strength
        bump.inputs["Distance"].default_value = distance
        links.new(coords.outputs["Object"], mapping.inputs[0])
        links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs[0])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(ramp.outputs[0], shader.inputs["Base Color"])
        links.new(bump.outputs[0], shader.inputs["Normal"])
    return mat


def cube(name, location, size, finish, bevel=0.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(finish)
    if bevel:
        soften(obj, bevel)
    return obj


def soften(obj, width):
    modifier = obj.modifiers.new("Rounded edges", "BEVEL")
    modifier.width = width
    modifier.segments = 3
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")


def mesh(name, vertices, faces, finish):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(finish)
    return obj


def line(name, positions, radius, finish):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new("POLY")
    spline.points.add(len(positions) - 1)
    for node, xyz in zip(spline.points, positions):
        node.co = (*xyz, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(finish)
    return obj


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("Soft daylight")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.69, 0.78, 0.92, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.42
    return scene


def light(name, position, target, energy, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.size, data.color = energy, size, color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def camera(scene, position, target, focal_length):
    data = bpy.data.cameras.new("Interior camera")
    obj = bpy.data.objects.new("Interior camera", data)
    scene.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    data.lens = focal_length
    scene.camera = obj
    return obj


def render(scene, target, width, height):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.adaptive_threshold = 0.035
    # Debian arm64 Blender does not ship OpenImageDenoiser.
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.transparent_max_bounces = 4
    scene.render.resolution_percentage = 100
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = target
    bpy.ops.render.render(write_still=True)
