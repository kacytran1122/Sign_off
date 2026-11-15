"""Render a small, wordless cutaway model for the reported repair scenario."""
import sys
from math import cos, pi, sin
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from guide_scene import camera, cube, light, line, material, mesh, render, setup


output, scenario, aid = sys.argv[sys.argv.index("--") + 1:]
scene = setup()
base = material("Matte stone", (0.66, 0.57, 0.47), 0.82)
wood = material("Light oak", (0.53, 0.32, 0.17), 0.53,
                texture=(10, (1, 12, 2), 0.21, 0.003, 0.68))
plaster = material("Cutaway plaster", (0.82, 0.77, 0.68), 0.8)
highlight = material("Noticeable water", (0.035, 0.36, 0.55), 0.23)
surface = material("Water on floor", (0.13, 0.52, 0.64), 0.20)
plastic = material("Blue bucket", (0.026, 0.15, 0.28), 0.38)
cloth = material("Warm cotton towel", (0.92, 0.68, 0.26), 0.88,
                 texture=(52, (1, 1, 1), 0.38, 0.004, 0.78))
rust = material("Damaged material", (0.56, 0.23, 0.12), 0.52)
metal = material("Brass hardware", (0.54, 0.32, 0.12), 0.42, metallic=0.65)
porcelain = material("White ceramic and pipe", (0.87, 0.9, 0.89), 0.32)
background = material("Studio backdrop", (0.69, 0.63, 0.66), 0.92)
cube("Backdrop", (0, 0, -0.27), (200, 200, 0.1), background, 0)
cube("Raised model base", (0, 0, -0.094), (3.64, 2.72, 0.23), base, 0.055)


def ball(name, location, radius, finish, stretch=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale.z = stretch
    obj.data.materials.append(finish)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def pool(name, x, y, z, width, depth, finish):
    vertices = [(x+width*cos(t)*(1+0.1*sin(5*t)), y+depth*sin(t), z)
                for t in (2*pi*i/72 for i in range(72))]
    return mesh(name, vertices, [tuple(range(72))], finish)


def bucket(x, y, z=0.03, scale=1):
    rings = [(0, 0), (.14, 0), (.155, .025), (.209, .338), (.222, .35),
             (.222, .367), (.204, .367), (.193, .35), (.141, .031), (0, .031)]
    n = 60
    points = [(x+r*scale*cos(t), y+r*scale*sin(t), z+h*scale)
              for r,h in rings for t in (2*pi*i/n for i in range(n))]
    faces = [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i)
             for j in range(len(rings)-1) for i in range(n)]
    body = mesh("Open blue bucket", points, faces, plastic)
    for face in body.data.polygons:
        face.use_smooth = True
    pool("Caught water", x, y, z+scale*.08, .146*scale, .146*scale, surface)


def drops(x, y, low, high, count):
    for i in range(count):
        fraction = (i+1)/(count+1)
        z = low+(high-low)*fraction
        radius = .030+.012*sin(fraction*pi)
        ball("Falling water", (x+.014*sin(i), y, z), radius, highlight, 1.38)


def caution(x, y):
    # A freestanding marker, offset so the route around the damage remains open.
    cube("Caution marker foot", (x, y, .05), (.40, .28, .07), rust)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=.17, radius2=.047, depth=.48,
                                    location=(x,y,.31))
    bpy.context.object.name = "Keep-clear visual marker"
    bpy.context.object.data.materials.append(cloth)


if scenario == "sink-leak":
    cube("Open cabinet platform", (0, .22, .15), (2.96, 1.63, .25), wood, .034)
    for x in (-1.4, 1.4):
        cube("Cabinet side wall", (x,.37,.97), (.14,1.51,1.68), wood, .024)
    cube("Cabinet back", (0,1.08,1.02), (2.94,.12,1.68), wood, .024)
    # Four countertop pieces expose the sink opening in the front cut.
    cube("Left countertop", (-1.03,.34,1.83), (.90,1.67,.15), plaster, .022)
    cube("Right countertop", (1.03,.34,1.83), (.90,1.67,.15), plaster, .022)
    cube("Back countertop", (0,.99,1.83), (1.18,.38,.15), plaster, .022)
    cube("Front lip of sink basin", (0,-.39,1.80), (1.18,.21,.09), porcelain, .037)
    cube("Underside of sink basin", (0,.24,1.54), (1.13,.99,.105), porcelain, .10)
    for x in (-.54,.54):
        cube("Side of sink basin", (x,.23,1.68), (.12,.99,.31), porcelain, .07)
    pipe = [(0,.06,1.57),(0,.06,1.05),(.035,.06,.93),(.15,.06,.87),(.28,.06,.88),
            (.345,.06,.99),(.35,.10,1.13),(.36,.78,1.15),(.36,1.13,1.15)]
    line("Exposed sink drain and trap", pipe, .073, porcelain)
    ball("Highlighted drip at drain joint", (.22,.05,.820), .054, highlight, 1.04)
    drops(.22,.04,.39,.80,4)
    if aid == "bucket":
        bucket(.22,.04,.278,.88)
    elif aid == "towel":
        cube("Towel under the drain", (.22,.04,.295), (.48,.49,.029), cloth, .032)
    else:
        caution(-1.15,-.94)
elif scenario == "damaged-window":
    cube("Window sill", (0,.1,.39), (2.78,.74,.18), plaster, .04)
    cube("Bottom wall section", (0,.30,.20), (2.7,.34,.34), plaster, .018)
    for x in (-1.12,1.12):
        cube("Window jamb", (x,.22,1.39), (.21,.18,1.91), wood, .035)
    for z in (.53,1.37,2.27):
        cube("Window sash", (0,.22,z), (2.29,.18,.17), wood, .025)
    pane = material("Muted window glass", (0.35, .56, .58), 0.26)
    cube("Upper pane", (0,.26,1.81), (2.00,.035,.74), pane, .015)
    cube("Lower pane", (0,.26,.95), (2.00,.035,.67), pane, .015)
    latch = cube("Lifted latch plate", (.02,.05,1.46), (.43,.26,.052), metal, .019)
    latch.rotation_euler.x = -.30
    line("Misaligned latch lever", [(0,-.08,1.51),(.15,-.14,1.55),(.27,-.24,1.56)], .044, metal)
    ball("Lifted fastener", (-.13,-.09,1.56), .042, rust, .75)
    caution(-1.1,-.76)
else:
    cube("Room floor cutaway", (0,0,.045), (3.51,2.6,.11), wood, .022)
    for i in range(8):
        y=-1.25+.156+i*.325
        line("Floorboard seam", [(-1.74,y,.101),(1.74,y,.101)], .005, base)
    has_ceiling = scenario == "ceiling-leak"
    wall_height = 2.26 if has_ceiling else .48
    cube("Cutaway back wall", (0,1.22,wall_height/2+.09), (3.5,.18,wall_height), plaster, .023)
    cube("Cutaway side wall", (-1.66,.69,wall_height/2+.09), (.18,.95,wall_height), plaster, .021)
    if has_ceiling:
        cube("Exposed ceiling panel", (-.56,.64,2.30), (2.18,1.36,.18), plaster, .026)
        pool("Damp ceiling patch", -.64, .09, 2.206, .28, .18, rust)
        drops(-.64,.09,.35,2.19,8)
    if aid == "bucket":
        bucket(-.64,.09,.105,1.18)
        cube("Flat towel beside bucket", (-.10,-.30,.126), (.69,.51,.042), cloth, .041)
    elif aid == "towel":
        pool("Visible shallow spill", -.47,.07,.112,.58,.31,surface)
        cube("Towel beside small spill", (.26,-.28,.126), (.67,.48,.043), cloth, .041)
    else:
        caution(.72,-.58)

light("Large warm key", (-3,-5,6), (0,0,1), 450, 4.4, (1,.92,.84))
light("Model fill", (4,-1,5), (0,0,.9), 330, 3.5, (.82,.9,1))
light("Soft separation", (1,3,4), (0,0,1), 240, 2.8, (1,.92,.85))
lens = camera(scene, (4.6,-7.4,4.9), (0,.1,1), 43)
lens.data.type = "ORTHO"
lens.data.ortho_scale = 5.35
render(scene, output, 1120, 900)
