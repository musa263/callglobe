from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
ASSETS = OUT / "assets"
PAGE_W, PAGE_H = landscape(A4)


HCC = {
    "code": "HCC",
    "name": "High Crafts General Contracting Est.",
    "short": "High Crafts",
    "subtitle": "Civil, Mechanical, Electrical, Construction, Manpower and Equipment Supply",
    "cr": "2055136077",
    "vat": "312500178500003",
    "address": "Al Jubail, Prince Mashoor St, Kingdom of Saudi Arabia",
    "email": "Haadii1221@gmail.com",
    "phone": "",
    "primary": colors.HexColor("#527f22"),
    "accent": colors.HexColor("#f08a24"),
    "out": OUT / "High-Crafts-HCC-Professional-Profile.pdf",
}


LEG = {
    "code": "LEG",
    "name": "Light of Extension General Contracting Est.",
    "short": "Light of Extension",
    "subtitle": "Civil, Mechanical, Electrical Engineering Works, Manpower and Certified Equipment Supply",
    "cr": "2055135215",
    "vat": "",
    "address": "Al Jubail, Prince Mashhoor Bin Abdulaziz St, Kingdom of Saudi Arabia",
    "email": "Info@loextension.com | sp.farhad22@gmail.com",
    "phone": "0552696196 | 0582255855",
    "primary": colors.HexColor("#0f8fa3"),
    "accent": colors.HexColor("#bd5b28"),
    "out": OUT / "Light-of-Extension-LEG-Professional-Profile.pdf",
}


SERVICES = [
    ("Civil Works", "Earthworks, trenching, ducting, backfilling, manholes, asphalt, paving, buildings and landscaping."),
    ("Mechanical Erection", "Piping, pipe racks, steel structures, tanks, insulation, painting, rigging and pre-commissioning support."),
    ("Electrical & Low Current", "Power distribution, lighting, grounding, fire alarm, CCTV, access control and cabling works."),
    ("Industrial Construction", "Fast-track plant and infrastructure works including foundations, structures, utilities and workshops."),
    ("Manpower Supply", "Engineers, supervisors, foremen, technicians, operators, welders, riggers, scaffolders and support staff."),
    ("Equipment Supply", "Cranes, boom trucks, buses, loaders, rollers, forklifts, JCBs, concrete pumps and transport equipment."),
]


MANPOWER = [
    ("Civil", "Civil engineer, supervisor, foreman, leadsman, helper, surveyor"),
    ("Mechanical", "Mechanical engineer, supervisor, foreman, fitter, fabricator, helper"),
    ("Electrical", "Electrical engineer, supervisor, foreman, industrial electrician, helper"),
    ("Instrument", "Instrument engineer, supervisor, technician, fitter, helper"),
    ("Safety", "Safety engineer, supervisor, officer, assistant and site support"),
    ("General", "Document controller, secretary, drivers, welders, riggers, scaffolders, steel erectors and steel fixers"),
]


PROJECTS = [
    ("Tasnee Housing Project", "Tasnee / RTCC", "Jubail"),
    ("Marafiq Housing Project", "Marafiq / Latifia", "Jubail"),
    ("Royal Commission Walkways and Hard Landscaping", "Royal Commission / Ahmed Amara", "Jubail"),
    ("Heavy Stone Retaining Wall", "J&P", "Salbookh Industrial Area"),
    ("Sea Bank and Canal Bank Stone Pitching", "Royal Commission / Azmil / Rawabi Fifa", "Jubail"),
    ("Flyover Water Drain Stone Pitching", "Royal Commission / CGC", "Jubail"),
    ("King Salman Palace Stone Walls, Diriyah", "Ministry of Culture", "Riyadh"),
    ("Heavy Stone Retaining Walls", "Sabak", "Hafar Al Batin"),
]


PROJECT_IMAGES = [
    ASSETS / "steam-tracing-installation.png",
    ASSETS / "steam-tracing-inspection.png",
]


def pstyle(size=10, color=colors.HexColor("#27313b"), leading=None, bold=False, align=TA_LEFT):
    return ParagraphStyle(
        name=f"s{size}{color}{bold}{align}",
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size,
        leading=leading or size * 1.35,
        textColor=color,
        alignment=align,
        spaceAfter=0,
    )


def para(c, text, x, y, w, h, size=10, color=colors.HexColor("#27313b"), bold=False, align=TA_LEFT):
    story = Paragraph(text.replace("&", "&amp;"), pstyle(size=size, color=color, bold=bold, align=align))
    story.wrapOn(c, w, h)
    story.drawOn(c, x, y + h - story.height)
    return story.height


def fit_text(c, text, x, y, max_w, size, color, font="Helvetica-Bold"):
    while size > 12 and stringWidth(text, font, size) > max_w:
        size -= 1
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, text)


def cover_image(c, image_path, x, y, w, h, overlay=0.18):
    with Image.open(image_path) as im:
        iw, ih = im.size
    scale = max(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    c.saveState()
    clip = c.beginPath()
    clip.rect(x, y, w, h)
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(str(image_path), x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, preserveAspectRatio=False, mask="auto")
    c.setFillColor(colors.Color(0, 0, 0, alpha=overlay))
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.restoreState()


def draw_header(c, cfg, title, page, footer=True):
    c.setFillColor(colors.white)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(cfg["primary"])
    c.rect(0, PAGE_H - 16 * mm, PAGE_W, 16 * mm, stroke=0, fill=1)
    c.setFillColor(cfg["accent"])
    c.rect(0, PAGE_H - 17 * mm, PAGE_W, 1.2 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(16 * mm, PAGE_H - 10.5 * mm, cfg["code"])
    c.setFont("Helvetica", 9)
    c.drawRightString(PAGE_W - 16 * mm, PAGE_H - 10.5 * mm, title)
    if footer:
        c.setFillColor(colors.HexColor("#88909a"))
        c.setFont("Helvetica", 8)
        c.drawCentredString(PAGE_W / 2, 8 * mm, f"{cfg['name']} | Company Profile | {page}")


def logo_mark(c, cfg, x, y, r=14 * mm):
    c.setFillColor(cfg["primary"])
    c.circle(x + r, y + r, r, stroke=0, fill=1)
    c.setFillColor(cfg["accent"])
    c.circle(x + r * 1.35, y + r * 1.35, r * 0.42, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20)
    c.drawCentredString(x + r, y + r - 5, cfg["code"])


def card(c, x, y, w, h, title, body, cfg):
    c.setFillColor(colors.HexColor("#f6f8fa"))
    c.roundRect(x, y, w, h, 4, stroke=0, fill=1)
    c.setFillColor(cfg["accent"])
    c.rect(x, y + h - 2.5 * mm, w, 2.5 * mm, stroke=0, fill=1)
    para(c, title, x + 6 * mm, y + h - 15 * mm, w - 12 * mm, 9 * mm, 11, cfg["primary"], True)
    para(c, body, x + 6 * mm, y + 7 * mm, w - 12 * mm, h - 24 * mm, 8.5)


def cover(c, cfg):
    cover_image(c, PROJECT_IMAGES[1], 0, 0, PAGE_W, PAGE_H, 0.36)
    c.setFillColor(cfg["primary"])
    c.rect(0, 0, 88 * mm, PAGE_H, stroke=0, fill=1)
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.09))
    c.circle(75 * mm, PAGE_H - 25 * mm, 35 * mm, stroke=0, fill=1)
    logo_mark(c, cfg, 18 * mm, PAGE_H - 45 * mm, 15 * mm)
    c.setFillColor(colors.white)
    fit_text(c, cfg["name"], 18 * mm, PAGE_H - 75 * mm, 62 * mm, 23, colors.white)
    para(c, cfg["subtitle"], 18 * mm, PAGE_H - 105 * mm, 58 * mm, 22 * mm, 11, colors.white)
    c.setStrokeColor(cfg["accent"])
    c.setLineWidth(2)
    c.line(18 * mm, PAGE_H - 113 * mm, 62 * mm, PAGE_H - 113 * mm)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(18 * mm, 35 * mm, "Company Profile")
    c.setFont("Helvetica", 10)
    c.drawString(18 * mm, 27 * mm, "Professional contracting, manpower and equipment services")
    c.showPage()


def overview(c, cfg, page):
    draw_header(c, cfg, "Overview", page)
    x = 18 * mm
    para(c, "Company Overview", x, PAGE_H - 50 * mm, 120 * mm, 16 * mm, 23, cfg["primary"], True)
    body = (
        f"{cfg['name']} is a Saudi-owned general contracting establishment based in Jubail. "
        "The company supports construction, civil, mechanical, electrical, maintenance, manpower and equipment requirements for industrial, infrastructure and commercial clients. "
        "Its operating model focuses on qualified supervision, trained site teams, dependable equipment and practical execution support across fast-moving project environments."
    )
    para(c, body, x, PAGE_H - 88 * mm, 150 * mm, 32 * mm, 11)
    items = [
        ("Commercial Registration", cfg["cr"]),
        ("VAT", cfg["vat"] or "Available upon request"),
        ("Location", "Jubail, Kingdom of Saudi Arabia"),
        ("Core Sectors", "Industrial plants, utilities, infrastructure, commercial and residential works"),
    ]
    y = PAGE_H - 118 * mm
    for label, val in items:
        c.setFillColor(cfg["primary"])
        c.setFont("Helvetica-Bold", 9)
        c.drawString(x, y, label.upper())
        para(c, val, x + 45 * mm, y - 4 * mm, 100 * mm, 10 * mm, 10)
        y -= 16 * mm
    c.setFillColor(colors.HexColor("#eef3f5"))
    c.roundRect(184 * mm, 30 * mm, 82 * mm, 122 * mm, 4, stroke=0, fill=1)
    para(c, "Operating Strengths", 194 * mm, 132 * mm, 60 * mm, 12 * mm, 16, cfg["primary"], True)
    strengths = ["Saudi-owned establishment", "Multi-discipline contracting capability", "Qualified manpower categories", "Equipment and transport support", "Safety-led site execution"]
    yy = 112 * mm
    for s in strengths:
        c.setFillColor(cfg["accent"])
        c.circle(196 * mm, yy + 2, 2.1, stroke=0, fill=1)
        para(c, s, 202 * mm, yy - 3 * mm, 50 * mm, 8 * mm, 10)
        yy -= 16 * mm
    c.showPage()


def capabilities(c, cfg, page):
    draw_header(c, cfg, "Capabilities", page)
    para(c, "Core Capabilities", 18 * mm, PAGE_H - 42 * mm, 120 * mm, 14 * mm, 22, cfg["primary"], True)
    cols = 3
    w = 82 * mm
    h = 42 * mm
    for i, (title, body) in enumerate(SERVICES):
        x = 18 * mm + (i % cols) * 90 * mm
        y = PAGE_H - 91 * mm - (i // cols) * 52 * mm
        card(c, x, y, w, h, title, body, cfg)
    c.showPage()


def manpower(c, cfg, page):
    draw_header(c, cfg, "Resources", page)
    para(c, "Manpower and Equipment Resources", 18 * mm, PAGE_H - 43 * mm, 160 * mm, 14 * mm, 22, cfg["primary"], True)
    x = 18 * mm
    y = PAGE_H - 67 * mm
    for group, roles in MANPOWER:
        c.setFillColor(colors.HexColor("#ffffff"))
        c.setStrokeColor(colors.HexColor("#dfe5ea"))
        c.roundRect(x, y - 19 * mm, 118 * mm, 16 * mm, 3, stroke=1, fill=1)
        c.setFillColor(cfg["primary"])
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x + 5 * mm, y - 9 * mm, group)
        para(c, roles, x + 35 * mm, y - 16 * mm, 76 * mm, 10 * mm, 8.5)
        y -= 22 * mm
    card(c, 164 * mm, 92 * mm, 102 * mm, 58 * mm, "Equipment Support", "Buses, mini buses, heavy trucks, water tankers, flat beds, dump trucks, cranes, boom trucks, graders, dozers, backhoes, rollers, JCBs, forklifts, concrete pumps and concrete mixers.", cfg)
    card(c, 164 * mm, 28 * mm, 102 * mm, 50 * mm, "Site Controls", "Document control, material supervision, site coordination, manpower allocation, equipment coordination and business support for project execution.", cfg)
    c.showPage()


def projects(c, cfg, page):
    draw_header(c, cfg, "Experience", page)
    para(c, "Selected Project Experience", 18 * mm, PAGE_H - 43 * mm, 160 * mm, 14 * mm, 22, cfg["primary"], True)
    x0, y0 = 18 * mm, PAGE_H - 64 * mm
    col_w = [82 * mm, 75 * mm, 58 * mm]
    headers = ["Project", "Client", "Location"]
    c.setFillColor(cfg["primary"])
    c.roundRect(x0, y0, sum(col_w), 10 * mm, 3, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 9)
    xx = x0
    for i, h in enumerate(headers):
        c.drawString(xx + 4 * mm, y0 + 3.5 * mm, h)
        xx += col_w[i]
    y = y0 - 10 * mm
    for i, row in enumerate(PROJECTS):
        c.setFillColor(colors.HexColor("#f8fafb") if i % 2 == 0 else colors.white)
        c.rect(x0, y, sum(col_w), 10 * mm, stroke=0, fill=1)
        xx = x0
        for j, val in enumerate(row):
            para(c, val, xx + 4 * mm, y + 1.5 * mm, col_w[j] - 7 * mm, 7 * mm, 8.2)
            xx += col_w[j]
        y -= 10 * mm
    card(c, 18 * mm, 28 * mm, 118 * mm, 36 * mm, "Stone, Landscaping and Civil Works", "Experience includes stone pitching, retaining walls, canals, sea banks, flyover drainage works, hard landscaping, interlock, curbstone, foundations, road activities and industrial fencing.", cfg)
    card(c, 148 * mm, 28 * mm, 118 * mm, 36 * mm, "Industrial Delivery", "Teams are structured to support fast-track industrial work from earthworks and foundations through mechanical erection, cabling, insulation and site finishing.", cfg)
    c.showPage()


def steam_project(c, cfg, page):
    draw_header(c, cfg, "Standalone Steam Tracing Project", page)
    cover_image(c, PROJECT_IMAGES[0], 18 * mm, 88 * mm, 248 * mm, 72 * mm, 0.08)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(28 * mm, 136 * mm, "Steam Tracing Project")
    c.setFont("Helvetica", 11)
    c.drawString(28 * mm, 126 * mm, "Standalone project capability page")
    para(c, "Scope of Work", 18 * mm, 65 * mm, 76 * mm, 10 * mm, 16, cfg["primary"], True)
    scope = "Installation support for steam tracing and associated small-bore tubing on process piping, including routing, fastening, insulation interface, valve station support, inspection readiness and commissioning assistance."
    para(c, scope, 18 * mm, 38 * mm, 78 * mm, 25 * mm, 9.5)
    para(c, "Execution Controls", 108 * mm, 65 * mm, 72 * mm, 10 * mm, 16, cfg["primary"], True)
    controls = "Work planning, PPE compliance, permit coordination, isolation awareness, material handling, quality checks, housekeeping and supervisor-led daily progress reporting."
    para(c, controls, 108 * mm, 38 * mm, 76 * mm, 25 * mm, 9.5)
    para(c, "Deliverables", 196 * mm, 65 * mm, 64 * mm, 10 * mm, 16, cfg["primary"], True)
    deliverables = "Installed tracing routes, protected tubing, valve and gauge support, inspection-ready insulation reinstatement and client handover documentation."
    para(c, deliverables, 196 * mm, 38 * mm, 68 * mm, 25 * mm, 9.5)
    c.showPage()


def safety(c, cfg, page):
    draw_header(c, cfg, "Safety and Quality", page)
    para(c, "Safety, Quality and Site Discipline", 18 * mm, PAGE_H - 43 * mm, 170 * mm, 14 * mm, 22, cfg["primary"], True)
    text = (
        f"{cfg['short']} recognizes occupational health and safety as a fundamental part of its business operations. "
        "No work priority comes before the health and safety of employees, client teams and surrounding assets. "
        "The company promotes continual improvement through supervision, monitoring, communication and practical corrective action."
    )
    para(c, text, 18 * mm, PAGE_H - 84 * mm, 150 * mm, 28 * mm, 11)
    cards = [
        ("HSE Commitment", "Protect employees, client personnel and project assets through active supervision and hazard awareness."),
        ("Quality Workmanship", "Execute work with trained professionals, defined scopes, practical checks and clear handover expectations."),
        ("Project Coordination", "Coordinate materials, manpower, equipment and site access to support disciplined project delivery."),
    ]
    for i, item in enumerate(cards):
        card(c, 18 * mm + i * 86 * mm, 55 * mm, 78 * mm, 42 * mm, item[0], item[1], cfg)
    c.showPage()


def contact(c, cfg, page):
    draw_header(c, cfg, "Contact", page, footer=False)
    logo_mark(c, cfg, 24 * mm, 106 * mm, 18 * mm)
    para(c, cfg["name"], 70 * mm, 124 * mm, 160 * mm, 28 * mm, 21, cfg["primary"], True)
    para(c, "Ready to support civil, mechanical, electrical, manpower, equipment and industrial project requirements.", 70 * mm, 95 * mm, 155 * mm, 14 * mm, 10.5)
    rows = [
        ("Commercial Registration", cfg["cr"]),
        ("VAT", cfg["vat"] or "Available upon request"),
        ("Address", cfg["address"]),
        ("Email", cfg["email"]),
    ]
    if cfg["phone"]:
        rows.append(("Mobile", cfg["phone"]))
    y = 82 * mm
    for label, value in rows:
        c.setFillColor(cfg["primary"])
        c.setFont("Helvetica-Bold", 9)
        c.drawString(70 * mm, y, label.upper())
        para(c, value, 120 * mm, y - 4 * mm, 112 * mm, 9 * mm, 10)
        y -= 12 * mm
    c.setFillColor(cfg["primary"])
    c.rect(0, 0, PAGE_W, 14 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica", 9)
    c.drawCentredString(PAGE_W / 2, 5.5 * mm, f"{cfg['name']} | Professional Company Profile")
    c.showPage()


def build_profile(cfg):
    c = canvas.Canvas(str(cfg["out"]), pagesize=landscape(A4))
    cover(c, cfg)
    overview(c, cfg, 2)
    capabilities(c, cfg, 3)
    manpower(c, cfg, 4)
    projects(c, cfg, 5)
    steam_project(c, cfg, 6)
    safety(c, cfg, 7)
    contact(c, cfg, 8)
    c.save()


def build_standalone(cfg):
    path = OUT / f"{cfg['code']}-Steam-Tracing-Project-Standalone.pdf"
    c = canvas.Canvas(str(path), pagesize=landscape(A4))
    steam_project(c, cfg, 1)
    c.save()
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for image in PROJECT_IMAGES:
        if not image.exists():
            raise FileNotFoundError(image)
    for cfg in (HCC, LEG):
        build_profile(cfg)
        build_standalone(cfg)
        print(cfg["out"])


if __name__ == "__main__":
    main()
