import sys

import bpy

locations = {
    "lobby": (-2.02, 0.23),
    "warehouse": (1.50, 0.23),
    "inspection": (0.90, 0.23),
}

location, output, *options = sys.argv[sys.argv.index("--") + 1:]
aid = options[0] if options else "none"
x, y = locations[location]
# Also accept a VM scene file created before the wordless guide update.
for obj in tuple(bpy.context.scene.objects):
    if obj.type == "FONT":
        bpy.data.objects.remove(obj, do_unlink=True)
for name in ("Inspection patch", "Vertical guide", "Report marker"):
    bpy.data.objects[name].location.x = x
    bpy.data.objects[name].location.y = y
if aid != "none":
    color = bpy.data.materials["Amber inspection area"]
    if aid == "bucket":
        # Open tapered bucket on the floor. A solidify modifier gives it a visible rim.
        bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=.24, radius2=.34,
                                       depth=.54, location=(x, y - .48, .50), end_fill_type="NOTHING")
        bucket = bpy.context.object
        bucket.data.materials.append(color)
        bucket.modifiers.new("Bucket wall", "SOLIDIFY").thickness = .035
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=.25, depth=.06, location=(x, y - .48, .25))
        bpy.context.object.data.materials.append(color)
        bpy.ops.mesh.primitive_torus_add(location=(x, y - .48, .77), major_radius=.34, minor_radius=.025)
        bpy.context.object.data.materials.append(color)
    elif aid == "towel":
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y - .48, .24))
        towel = bpy.context.object
        towel.dimensions = (.88, .63, .08)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        towel.data.materials.append(color)
        towel.modifiers.new("Soft edges", "BEVEL").width = .034
    else:
        for angle in (-.72, .72):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y - .55, .25))
            marker = bpy.context.object
            marker.scale = (.8, .09, .045)
            marker.rotation_euler.z = angle
            marker.data.materials.append(color)
bpy.context.scene.render.filepath = output
bpy.ops.render.render(write_still=True)
