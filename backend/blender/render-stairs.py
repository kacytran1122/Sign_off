"""Show a damaged tread and a wordless warning posted from the intact landing."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from guide_scene import camera, cube, light, line, material, mesh, render, setup, soften


scene = setup()
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.26
oak = material("Existing red oak", (0.43, 0.20, 0.083), 0.42,
               texture=(18, (1, 13, 10), 0.28, 0.009, 0.52))
end_grain = material("Fresh splintered edge", (0.59, 0.32, 0.147), 0.82,
                     texture=(42, (1, 9, 1), 0.40, 0.010, 0.51))
riser = material("Painted stair risers", (0.70, 0.63, 0.53), 0.63,
                 texture=(100, (1, 1, 1), 0.18, 0.005, 0.92))
wall = material("Wall paint", (0.71, 0.765, 0.715), 0.80,
                texture=(130, (1, 1, 1), 0.20, 0.004, 0.92))
trim = material("White wall trim", (0.87, 0.85, 0.77), 0.42)
paper = material("Office paper", (0.86, 0.84, 0.72), 0.93)
tape = material("Masking tape", (0.63, 0.42, 0.18), 0.73)
marker = material("Dark steel rail brackets", (0.043, 0.038, 0.033), 0.49, metallic=0.47)
warning_ink = material("Red warning symbol", (0.51, 0.022, 0.015), 0.79)
shadows = material("Inside damaged cavity", (0.07, 0.044, 0.027), 0.93)

rise, run, width = 0.176, 0.274, 1.01
first_y = -0.40
tread_depth = run + 0.03
tread_thickness = 0.031


def broken_tread(y, z):
    a, b = -width / 2, width / 2
    front, back = y - tread_depth / 2, y + tread_depth / 2
    outline = [(a, front), (-0.31, front), (-0.27, front + 0.068),
               (-0.23, front + 0.020), (-0.20, front + 0.131), (-0.15, front + 0.164),
               (-0.09, front + 0.122), (-0.05, front + 0.189), (0.016, front + 0.153),
               (0.065, front + 0.192), (0.105, front + 0.109), (0.16, front + 0.13),
               (0.19, front + 0.047), (0.26, front), (b, front), (b, back), (a, back)]
    count = len(outline)
    vertices = [(u, v, h) for h in (z - tread_thickness, z) for u, v in outline]
    faces = [tuple(reversed(range(count))), tuple(range(count, 2 * count))]
    faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
    obj = mesh("Split tread with exposed wood fibers", vertices, faces, oak)
    obj.data.materials.append(end_grain)
    for index, polygon in enumerate(obj.data.polygons[2:]):
        polygon.material_index = int(1 <= index <= 12)
    soften(obj, 0.002)



wall_x = -0.59
for i in range(8):
    x = -0.499 + i * 0.143
    seam = -2.16 + 0.17 * (i % 4)
    for front, back in ((-3.60, seam), (seam + 0.002, -0.505)):
        cube("Staggered oak landing board", (x, (front + back) / 2, 0.006),
             (0.140, back - front, 0.024), oak, 0.001)
cube("Left plaster wall", (wall_x, -0.95, 1.52), (0.12, 5.38, 3.04), wall)
cube("Right plaster wall", (-wall_x, -0.95, 1.52), (0.12, 5.38, 3.04), wall)
cube("Painted wall above upper landing", (0, 1.69, 2.32), (1.12, 0.12, 2.50), wall)
cube("Painted door", (0, 1.605, 2.111), (0.76, 0.043, 2.08), trim, 0.006)
for x in (-0.407, 0.407):
    cube("Door casing", (x, 1.585, 2.124), (0.046, 0.045, 2.112), trim, 0.004)
cube("Door casing at top", (0, 1.585, 3.194), (0.86, 0.045, 0.05), trim, 0.004)
for center, height in ((1.56, 0.63), (2.60, 0.84)):
    for x in (-0.246, 0.246):
        cube("Narrow vertical door molding", (x, 1.58, center), (0.015, 0.016, height), trim, 0.004)
    for z in (center - height / 2, center + height / 2):
        cube("Narrow horizontal door molding", (0, 1.58, z), (0.50, 0.016, 0.015), trim, 0.004)
line("Door lever", [(0.285, 1.572, 2.04), (0.285, 1.541, 2.04), (0.19, 1.541, 2.04)],
     0.008, marker)
cube("Landing skirting", (wall_x + 0.064, -2.06, 0.067), (0.019, 3.07, 0.10), trim)
cube("Opposite landing skirting", (-wall_x - 0.064, -2.06, 0.067), (0.019, 3.07, 0.10), trim)
cube("Support below upper landing", (0, 1.249, 0.52), (width, 0.88, 1.04), riser)
cube("Upper oak landing", (0, 1.249, 1.055), (width, 0.88, 0.034), oak)
for i in range(6):
    y = first_y + i * run
    z = (i + 1) * rise + 0.017
    if i == 2:
        for x, span in ((-0.398, 0.205), (0.376, 0.25)):
            cube("Riser remaining beside the damage", (x, y - 0.125, z - 0.103),
                 (span, 0.026, 0.145), riser, 0.002)
        cube("Shadow inside the broken stair", (0, y - 0.046, z - 0.082),
             (0.62, 0.029, 0.12), shadows)
        broken_tread(y, z)
    else:
        cube("Painted riser", (0, y - 0.125, z - 0.103),
             (width, 0.026, 0.145), riser, 0.002)
        cube("Oak tread with rounded nosing", (0, y, z - tread_thickness / 2),
             (width, tread_depth, tread_thickness), oak, 0.005)

rail = ((wall_x + 0.112, -0.62, 0.94), (wall_x + 0.112, 1.10, 2.04))
line("Rounded wood handrail", rail, 0.027, oak)
for along in (0.18, 0.61, 0.90):
    y, z = (rail[0][axis] + along * (rail[1][axis] - rail[0][axis]) for axis in (1, 2))
    line("Handrail bracket", [(wall_x + 0.065, y, z - 0.036), (wall_x + 0.112, y, z - 0.016)],
         0.009, marker)

# Tape a legible pictogram to the wall on the safe side of the tread.
sign_y, sign_z = -1.30, 1.16
cube("Paper warning on the intact landing wall", (wall_x + 0.061, sign_y, sign_z),
     (0.0012, 0.24, 0.23), paper, 0)
for side in (-1, 1):
    tab = cube("Masking tape overlapping paper and wall", (wall_x + 0.063, sign_y + side * 0.106, sign_z + 0.106),
               (0.002, 0.023, 0.063), tape, 0.0006)
    tab.rotation_euler.x = side * 0.39
surface = wall_x + 0.063
tip = (surface, sign_y, sign_z + 0.069)
line("Triangular warning outline", [tip, (surface, sign_y + 0.073, sign_z - 0.060),
                                   (surface, sign_y - 0.073, sign_z - 0.060), tip], 0.006, warning_ink)
line("Upper mark in the pictogram", [(surface, sign_y, sign_z + 0.028),
                                   (surface, sign_y, sign_z - 0.012)], 0.006, warning_ink)
line("Dot in the pictogram", [(surface, sign_y, sign_z - 0.032),
                             (surface, sign_y, sign_z - 0.035)], 0.006, warning_ink)

light("Daylight from above the upper landing", (0, 0.62, 2.88), (0, -0.15, 0.27),
      260, 1.15, (1, 0.88, 0.72))
light("Daylight from the hall", (0.26, -2.59, 2.29), (-0.22, -0.32, 0.87),
      90, 1.5, (0.86, 0.94, 1))
camera(scene, (0.34, -2.84, 1.45), (-0.17, -0.03, 0.82), 34)
render(scene, sys.argv[sys.argv.index("--") + 1], 1248, 1048)
