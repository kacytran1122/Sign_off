"""Show the warning at the landing and an example of a fitted replacement tread."""
import sys

sys.path.insert(0, "/opt/fix-this-spot-blender")
from mathutils import Matrix, Vector
from guide_scene import camera, caption, cube, editorial_ink, lettering, light, line, material, mesh, render, setup, soften


scene = setup()
oak = material("Existing red oak", (0.46, 0.24, 0.105), 0.42,
               texture=(18, (1, 13, 10), 0.28, 0.009, 0.52))
new = material("Fitted new oak", (0.57, 0.33, 0.15), 0.40,
               texture=(18, (1, 13, 10), 0.26, 0.008, 0.53))
support = material("Oak stair stringer", (0.33, 0.166, 0.074), 0.58,
                   texture=(17, (1, 1, 14), 0.26, 0.007, 0.52))
end_grain = material("Fresh splintered edge", (0.59, 0.32, 0.147), 0.82,
                     texture=(42, (1, 9, 1), 0.40, 0.010, 0.51))
riser = material("Painted stair risers", (0.70, 0.63, 0.53), 0.63,
                 texture=(100, (1, 1, 1), 0.18, 0.005, 0.92))
wall = material("Wall paint", (0.71, 0.765, 0.715), 0.80,
                texture=(130, (1, 1, 1), 0.20, 0.004, 0.92))
trim = material("White wall trim", (0.87, 0.85, 0.77), 0.42)
paper = material("Office paper", (0.86, 0.84, 0.72), 0.93)
tape = material("Masking tape", (0.63, 0.42, 0.18), 0.73)
marker = material("Black marker", (0.014, 0.017, 0.018), 0.75)
stage = material("Room cutaway background", (0.56, 0.64, 0.645), 0.91)
subfloor = material("Visible floor section", (0.23, 0.22, 0.19))
shadows = material("Inside damaged cavity", (0.07, 0.044, 0.027), 0.93)
cube("Studio floor", (0, 0, -0.15), (200, 200, 0.12), stage, 0)

rise, run, width = 0.176, 0.274, 1.01
first_y = -0.40
tread_depth = run + 0.03
tread_thickness = 0.031


def broken_tread(x, y, z):
    a, b = -width / 2, width / 2
    front, back = y - tread_depth / 2, y + tread_depth / 2
    outline = [(a, front), (-0.31, front), (-0.27, front + 0.068),
               (-0.23, front + 0.020), (-0.20, front + 0.131), (-0.15, front + 0.164),
               (-0.09, front + 0.122), (-0.05, front + 0.189), (0.016, front + 0.153),
               (0.065, front + 0.192), (0.105, front + 0.109), (0.16, front + 0.13),
               (0.19, front + 0.047), (0.26, front), (b, front), (b, back), (a, back)]
    count = len(outline)
    vertices = [(x + u, v, h) for h in (z - tread_thickness, z) for u, v in outline]
    faces = [tuple(reversed(range(count))), tuple(range(count, 2 * count))]
    faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
    obj = mesh("Split tread with exposed wood fibers", vertices, faces, oak)
    obj.data.materials.append(end_grain)
    for index, polygon in enumerate(obj.data.polygons[2:]):
        polygon.material_index = int(1 <= index <= 12)
    soften(obj, 0.002)


def stairwell(x, repaired):
    # Both examples share the same floor, stair pitch, and supports.
    wall_x = x - 0.59
    cube("Sectioned landing", (x - 0.04, -0.17, -0.04), (1.26, 2.76, 0.11), subfloor)
    for i in range(8):
        cube("Landing floorboard", (x - 0.512 + i * 0.143, -1.04, 0.006),
             (0.140, 1.013, 0.024), oak, 0.001)
    cube("Side wall", (wall_x, -0.16, 0.952), (0.12, 2.76, 1.90), wall)
    cube("Landing skirting", (wall_x + 0.064, -1.03, 0.071), (0.019, 1.02, 0.10), trim)
    cube("Support below upper landing", (x, 1.011, 0.52), (1.01, 0.41, 1.04), riser)
    cube("Upper landing", (x, 1.011, 1.055), (width, 0.41, 0.034), oak)
    for i in range(6):
        y = first_y + i * run
        z = (i + 1) * rise + 0.017
        damaged = i == 2 and not repaired
        if damaged:
            for xa, w in ((x - 0.398, 0.205), (x + 0.376, 0.25)):
                cube("Riser remaining beside the damage", (xa, y - 0.125, z - 0.103),
                     (w, 0.026, 0.145), riser, 0.002)
            cube("Visible cavity behind broken tread", (x, y - 0.046, z - 0.082),
                 (0.62, 0.029, 0.12), shadows)
            broken_tread(x, y, z)
        else:
            cube("Riser below the tread", (x, y - 0.125, z - 0.103), (width, 0.026, 0.145), riser, 0.002)
            cube("Fitted replacement tread" if i == 2 else "Existing tread", (x, y, z - tread_thickness / 2),
                 (width, tread_depth, tread_thickness), new if i == 2 else oak, 0.005)
        cube("Cutaway edge of stair support", (x + 0.506, y + 0.003, z - 0.104),
             (0.033, run, 0.144), oak, 0.002)
    # Expose the continuous outer support below the treads in the cutaway.
    outline = [(-0.528, 0.018), (0.97, 0.995), (1.008, 0.785), (-0.22, 0.018)]
    vertices = [(x + offset, y, z) for offset in (0.445, 0.493) for y, z in outline]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4)]
    faces += [(i, i + 4, (i + 1) % 4 + 4, (i + 1) % 4) for i in range(4)]
    soften(mesh("Continuous outer stair stringer", vertices, faces, support), 0.003)
    rail = ((wall_x + 0.112, -0.62, 0.94), (wall_x + 0.112, 1.10, 2.04))
    line("Rounded wood handrail", rail, 0.031, oak)
    for a in (0.18, 0.61, 0.90):
        y, z = (rail[0][j] + a * (rail[1][j] - rail[0][j]) for j in (1, 2))
        line("Handrail bracket", [(wall_x + 0.065, y, z - 0.036), (wall_x + 0.112, y, z - 0.016)],
             0.011, marker)
    if repaired:
        return
    sign_y, sign_z = -1.04, 1.09
    cube("Paper on the wall at the intact landing", (wall_x + 0.061, sign_y, sign_z),
         (0.0012, 0.345, 0.243), paper, 0)
    for s in (-1, 1):
        tab = cube("Masking tape overlapping the paper and wall",
                   (wall_x + 0.063, sign_y + s * 0.15, sign_z + 0.115),
                   (0.002, 0.027, 0.068), tape, 0.0006)
        tab.rotation_euler.x = s * 0.39
    front = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))).to_euler()
    lettering("DAMAGED STEP", (wall_x + 0.064, sign_y, sign_z + 0.026), front, 0.036, marker, "CENTER")
    lettering("KEEP CLEAR", (wall_x + 0.064, sign_y, sign_z - 0.039), front, 0.036, marker, "CENTER")


for x, repaired in ((-1.38, False), (1.38, True)):
    prior = set(scene.objects)
    stairwell(x, repaired)
    # Space the two stairwells along the camera's horizontal axis.
    for obj in set(scene.objects) - prior:
        obj.location += Vector((0, x * 0.5, 0))
light("Warm daylight", (1.1, -3.8, 5), (0, 0, 0.8), 840, 5, (1, 0.89, 0.75))
light("Open stairwell bounce", (-2.8, -1.4, 3.1), (0, 0, 0.8), 470, 3.6, (0.78, 0.88, 1))
view = camera(scene, (4.9, -10, 5.25), (-0.08, -0.03, 0.97), 6.1)
ink = editorial_ink()
caption(view, "A broken stair tread", -2.74, 2.02, 0.235, ink)
caption(view, "TEMPORARY WARNING", -2.72, -1.72, 0.127, ink)
caption(view, "Use paper, marker and tape.\nPost the warning on the landing wall.", -2.72, -1.91, 0.114, ink)
caption(view, "EXAMPLE PROFESSIONAL REPAIR", 0.10, -1.72, 0.127, ink)
caption(view, "Inspect and repair the supports.\nFit a tread before reopening the stair.", 0.10, -1.91, 0.114, ink)
render(scene, sys.argv[sys.argv.index("--") + 1], 1536, 1192)
