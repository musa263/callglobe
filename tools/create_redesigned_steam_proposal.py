from pathlib import Path
from textwrap import wrap

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
ASSETS = OUT / "assets"
PDF = OUT / "High-Craft-Steam-Tracing-Proposal-Redesigned.pdf"

W, H = letter
M = 0.62 * inch
GREEN = colors.HexColor("#315f2a")
GOLD = colors.HexColor("#d8902f")
INK = colors.HexColor("#24313a")
MUTED = colors.HexColor("#6d7882")
SOFT = colors.HexColor("#f3f6f2")
DARK = colors.HexColor("#10251f")


def style(size=10, leading=None, color=INK, bold=False, align=TA_LEFT):
    return ParagraphStyle(
        name=f"s{size}{leading}{color}{bold}{align}",
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size,
        leading=leading or size * 1.35,
        textColor=color,
        alignment=align,
        spaceAfter=0,
    )


def para(c, text, x, y, w, h, size=10, color=INK, bold=False, align=TA_LEFT, leading=None):
    p = Paragraph(text.replace("&", "&amp;"), style(size, leading, color, bold, align))
    p.wrapOn(c, w, h)
    p.drawOn(c, x, y + h - p.height)
    return p.height


def fit(c, text, x, y, max_w, size, color=INK, font="Helvetica-Bold"):
    while size > 10 and stringWidth(text, font, size) > max_w:
        size -= 0.5
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, text)


def cover_image(c, path, x, y, w, h, overlay=0.25):
    with Image.open(path) as im:
        iw, ih = im.size
    scale = max(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    c.saveState()
    clip = c.beginPath()
    clip.rect(x, y, w, h)
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(str(path), x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, mask="auto")
    c.setFillColor(colors.Color(0, 0, 0, alpha=overlay))
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.restoreState()


def header(c, title, page):
    c.setFillColor(colors.white)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(GREEN)
    c.rect(0, H - 0.48 * inch, W, 0.48 * inch, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.rect(0, H - 0.51 * inch, W, 0.035 * inch, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(M, H - 0.31 * inch, "HIGH CRAFT GENERAL CONTRACTING")
    c.setFont("Helvetica", 8.5)
    c.drawRightString(W - M, H - 0.31 * inch, title)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2, 0.35 * inch, f"Steam Tracing Tubing System Proposal | Confidential | {page}")


def section_title(c, title, y):
    c.setFillColor(GOLD)
    c.rect(M, y - 0.08 * inch, 0.38 * inch, 0.035 * inch, stroke=0, fill=1)
    fit(c, title, M + 0.48 * inch, y - 0.12 * inch, W - 2 * M, 17, GREEN)


def capsule(c, title, body, x, y, w, h, accent=GREEN):
    c.setFillColor(SOFT)
    c.roundRect(x, y, w, h, 8, stroke=0, fill=1)
    c.setFillColor(accent)
    c.roundRect(x, y + h - 0.15 * inch, w, 0.15 * inch, 8, stroke=0, fill=1)
    para(c, title, x + 0.22 * inch, y + h - 0.48 * inch, w - 0.44 * inch, 0.24 * inch, 9.5, accent, True)
    para(c, body, x + 0.22 * inch, y + 0.2 * inch, w - 0.44 * inch, h - 0.75 * inch, 8.6, INK)


def bullet(c, text, x, y, w, color=INK, size=9.4):
    c.setFillColor(GOLD)
    c.circle(x + 3, y + 4, 2.2, stroke=0, fill=1)
    used = para(c, text, x + 0.16 * inch, y - 0.04 * inch, w - 0.16 * inch, 0.42 * inch, size, color)
    return max(0.32 * inch, used + 0.08 * inch)


def cover(c):
    img = ASSETS / "steam-tracing-inspection.png"
    cover_image(c, img, 0, 0, W, H, 0.40)
    c.setFillColor(colors.Color(0.04, 0.12, 0.09, alpha=0.92))
    c.rect(0, 0, 2.15 * inch, H, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.circle(1.08 * inch, H - 1.25 * inch, 0.22 * inch, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(1.08 * inch, H - 1.30 * inch, "HC")
    c.setFont("Helvetica-Bold", 8.5)
    for i, line in enumerate(wrap("HIGH CRAFT GENERAL CONTRACTING", 17)):
        c.drawCentredString(1.08 * inch, H - 1.75 * inch - i * 0.15 * inch, line)
    c.setStrokeColor(GOLD)
    c.setLineWidth(1.4)
    c.line(0.42 * inch, H - 2.35 * inch, 1.74 * inch, H - 2.35 * inch)
    c.setFillColor(colors.white)
    fit(c, "Steam Tracing Tubing System", 2.65 * inch, H - 2.05 * inch, 3.95 * inch, 28, colors.white)
    para(c, "Procurement, site installation, testing, commissioning support and turnover on an LSTK basis", 2.65 * inch, H - 2.75 * inch, 4.5 * inch, 0.6 * inch, 12.5, colors.white)
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.90))
    c.roundRect(2.65 * inch, 0.95 * inch, 4.55 * inch, 1.35 * inch, 10, stroke=0, fill=1)
    para(c, "Prepared for TCC - Tianchien Company, Kingdom of Saudi Arabia<br/>Proposal No. HCGC-STT-2026-041<br/>Proposal Date: 26 June 2026<br/>Validity: 90 calendar days", 2.9 * inch, 1.13 * inch, 4.05 * inch, 1.0 * inch, 9.5, DARK)
    c.showPage()


def page_intro(c):
    header(c, "Offer Overview", 2)
    section_title(c, "Technical-Commercial Offer", H - 0.95 * inch)
    intro = (
        "High Craft General Contracting is pleased to submit this redesigned offer for the steam tracing tubing package. "
        "The proposal covers procurement, field installation, fitting make-up, inspection support, testing assistance, commissioning support and final turnover documentation. "
        "The package is offered as a firm lump-sum turnkey scope, excluding VAT."
    )
    para(c, intro, M, H - 1.7 * inch, W - 2 * M, 0.7 * inch, 10.4)
    capsule(c, "Project Commitment", "High Craft is ready to execute the package within five weeks after purchase order release, approved workfront availability and site access.", M, H - 2.85 * inch, 2.1 * inch, 0.95 * inch)
    capsule(c, "Commercial Value", "The net LSTK value is SAR 1,400,000 excluding VAT. VAT at 15% is SAR 210,000, giving a gross value of SAR 1,610,000.", M + 2.32 * inch, H - 2.85 * inch, 2.1 * inch, 0.95 * inch, GOLD)
    capsule(c, "Reference", "The offer is based on the referenced material take-off document PIPING_MTO-SS_TUBE and the understood project requirements.", M + 4.64 * inch, H - 2.85 * inch, 2.1 * inch, 0.95 * inch)
    section_title(c, "Basis of Offer", H - 3.55 * inch)
    y = H - 4.05 * inch
    for text in [
        "The work is treated as a precision tubing scope where routing control, ferrule make-up, inspection discipline and workfront sequence are critical.",
        "The copper tubing requirement is based on 1/2 in. x 0.049 in. seamless ASTM B68 C12200 DHP tubing with copper-alloy fittings.",
        "The stainless-steel tubing requirement is based on 1/2 in. x 0.035 in. seamless ASTM A269 TP316/316L tubing with TP316 ferrule fittings.",
        "Compression adapters are understood as ASTM A105 carbon-steel items at the identified connection points.",
        "Execution will follow ASME B31.3, applicable Saudi regulations, client site rules and approved project procedures.",
    ]:
        y -= bullet(c, text, M, y, W - 2 * M)
    c.showPage()


def page_scope(c):
    header(c, "Scope and Method", 3)
    section_title(c, "How the Work Will Be Delivered", H - 0.95 * inch)
    capsule(c, "Review and Planning", "Before site work starts, High Craft will review IFC drawings, isometrics, access constraints and approved workfronts. The team will confirm routing requirements and release materials in a controlled sequence.", M, H - 2.25 * inch, 3.05 * inch, 1.0 * inch)
    capsule(c, "Supply and Receiving", "Tubing, fittings, adapters, tags, markers, sealants and support accessories will be arranged with material certificate control and site receipt inspection.", M + 3.28 * inch, H - 2.25 * inch, 3.05 * inch, 1.0 * inch, GOLD)
    capsule(c, "Field Installation", "The site team will cut, bend, deburr, route and support the tubing using controlled field measurements. Fittings will be made up with calibrated tools, gap checks and supervisor oversight.", M, H - 3.55 * inch, 3.05 * inch, 1.0 * inch)
    capsule(c, "Testing and Turnover", "Punch items will be closed progressively. The team will support steam trace-out, verify flow direction, compile records and submit the final handover file.", M + 3.28 * inch, H - 3.55 * inch, 3.05 * inch, 1.0 * inch, GOLD)
    section_title(c, "Included Scope", H - 4.2 * inch)
    y = H - 4.72 * inch
    for text in [
        "Supply of copper and stainless-steel tubing identified for the package.",
        "Supply of copper-alloy compression fittings, TP316 ferrule fittings and ASTM A105 carbon-steel compression adapters.",
        "Provision of consumables, support materials, tags, markers, sealants and fitting accessories required for the included work.",
        "Mobilization of supervision, skilled technicians, helpers, tools, HSE provisions and documentation support.",
        "Tubing fabrication, routing, support, fitting installation, manifold and tie-in connection activities.",
        "Line marking, tag installation, flow-direction identification, progressive quality checks, punch-list closure and final acceptance support.",
    ]:
        y -= bullet(c, text, M, y, W - 2 * M)
    c.showPage()


def page_quantities(c):
    header(c, "Quantities and Resources", 4)
    section_title(c, "Material Quantity Summary in Words", H - 0.95 * inch)
    text = (
        "The material package includes approximately 1,100 meters of seamless copper tubing and approximately 2,600 meters of seamless annealed stainless-steel tubing. "
        "The combined tubing length is therefore about 3,700 meters. The fitting package includes copper unions, copper reducing unions, copper equal tees, TP316 male and female connectors, TP316 unions, TP316 reducing unions, 90-degree male and female elbows, and ASTM A105 compression adapters. "
        "Together, the fittings and adapters amount to about 1,070 pieces."
    )
    para(c, text, M, H - 1.85 * inch, W - 2 * M, 0.9 * inch, 10.2)
    capsule(c, "Copper Tubing", "About 1,100 meters of 1/2 in. x 0.049 in. seamless ASTM B68 C12200 tubing, supported by copper-alloy fittings.", M, H - 3.0 * inch, 2.0 * inch, 0.9 * inch)
    capsule(c, "Stainless-Steel Tubing", "About 2,600 meters of 1/2 in. x 0.035 in. seamless ASTM A269 TP316/316L tubing with TP316 ferrule fittings.", M + 2.25 * inch, H - 3.0 * inch, 2.15 * inch, 0.9 * inch, GOLD)
    capsule(c, "Adapters and Fittings", "About 1,070 fittings and adapters, including connectors, unions, elbows, reducers and compression adapters.", M + 4.65 * inch, H - 3.0 * inch, 2.0 * inch, 0.9 * inch)
    section_title(c, "Project Team and Tools", H - 3.7 * inch)
    para(c, "The planned site organization is a compact nineteen-person team consisting of a part-time project manager, mechanical/piping site engineer, two tubing supervisors, one QC inspector, one safety officer, eight skilled tube fitters, three helpers, a storekeeper/document controller and a driver. The planned duration for these resources is thirty-five days.", M, H - 4.45 * inch, W - 2 * M, 0.65 * inch, 10)
    para(c, "The tool spread will include manual and hydraulic tube benders, calibrated torque wrenches, ferrule tools, gap-inspection tools, cutting and deburring kits, marking and tagging materials, support tools, PPE, site store provisions and HSE consumables.", M, H - 5.28 * inch, W - 2 * M, 0.55 * inch, 10)
    section_title(c, "Programme", H - 5.95 * inch)
    para(c, "The work is planned as a five-week activity: first, kick-off and workfront review; then mobilization and receiving inspection; followed by installation, tie-ins, fitting make-up and progressive checks; and finally punch-list closeout, steam trace-out support, commissioning assistance, dossier issue and demobilization.", M, H - 6.65 * inch, W - 2 * M, 0.55 * inch, 10)
    c.showPage()


def page_commercial(c):
    header(c, "Commercial and Payment", 5)
    section_title(c, "Commercial Offer in Plain Words", H - 0.95 * inch)
    para(c, "The total net lump-sum price for the complete LSTK package is SAR 1,400,000 excluding VAT. This includes the supply package and the construction, supervision, testing support and handover services required for the included scope.", M, H - 1.62 * inch, W - 2 * M, 0.55 * inch, 10.3)
    capsule(c, "Supply Package", "SAR 900,000 is allowed for tubing, fittings, adapters, consumables, minor materials and supply-related handling.", M, H - 2.75 * inch, 2.05 * inch, 0.92 * inch)
    capsule(c, "Site Services", "SAR 500,000 is allowed for installation manpower, supervision, QA/QC, tools, equipment, mobilization, HSE, testing support and commissioning support.", M + 2.32 * inch, H - 2.75 * inch, 2.2 * inch, 0.92 * inch, GOLD)
    capsule(c, "Gross Value", "VAT at 15% is SAR 210,000. The total value including VAT is SAR 1,610,000.", M + 4.83 * inch, H - 2.75 * inch, 1.9 * inch, 0.92 * inch)
    section_title(c, "Payment", H - 3.48 * inch)
    payment = (
        "Payment will be handled in simple progress-based words. "
        "After the purchase order is issued, High Craft will request an advance to start procurement and mobilization. "
        "As materials arrive and site work moves forward, High Craft will submit clear invoices with the related supporting documents, such as delivery records, site progress confirmation, inspection records or accepted handover documents. "
        "Each correct invoice will be payable within thirty days after approval. The final payment will be requested after testing support, commissioning assistance and the turnover file are completed."
    )
    para(c, payment, M, H - 4.65 * inch, W - 2 * M, 0.98 * inch, 10.3)
    c.setFillColor(SOFT)
    c.roundRect(M, H - 6.35 * inch, W - 2 * M, 1.05 * inch, 10, stroke=0, fill=1)
    para(c, "Simple Payment Understanding", M + 0.28 * inch, H - 5.68 * inch, W - 2 * M - 0.56 * inch, 0.22 * inch, 11, GREEN, True)
    para(c, "The client pays against approved invoices. High Craft provides the evidence needed for review and approval before each payment is released.", M + 0.28 * inch, H - 6.12 * inch, W - 2 * M - 0.56 * inch, 0.38 * inch, 9.8)
    c.showPage()


def page_terms(c):
    header(c, "Terms and Conditions", 6)
    section_title(c, "Reworded Terms and Conditions", H - 0.95 * inch)
    terms = [
        ("Offer Period", "This offer will remain open for ninety calendar days from the proposal date. After that period, pricing and availability may be reviewed before acceptance."),
        ("Work Schedule", "The price is based on one regular shift of eight working hours per day and six working days per week. Any overtime, night work or premium-time requirement must be approved separately."),
        ("Scope Changes", "If the final route, quantity, specification or workfront changes materially from the referenced basis, the commercial impact will be agreed through a written change instruction before the extra work proceeds."),
        ("Client Support", "The client will provide timely site access, gate passes, lay-down space, utilities, approved drawings, permit-to-work support and required isolation windows so the work can move without avoidable delay."),
        ("Warranty", "High Craft will stand behind its workmanship for twelve months from acceptance. Manufacturer or supplier warranties for materials will be transferred to the client where they are available."),
        ("Not Included", "Civil works, electrical works, upstream steam piping, insulation removal or insulation replacement, customs duties on client free-issue materials and any item not clearly included in this offer are outside the price."),
    ]
    y = H - 1.72 * inch
    for title, body in terms:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 10.5)
        c.drawString(M, y, title)
        para(c, body, M + 1.45 * inch, y - 0.16 * inch, W - 2 * M - 1.45 * inch, 0.42 * inch, 9.3)
        y -= 0.76 * inch
    section_title(c, "Acceptance", H - 6.6 * inch)
    para(c, "This proposal may be accepted by issuing an agreed purchase order or by signature of authorized representatives of both parties. Once accepted, it may be used as the technical and commercial basis for award.", M, H - 7.24 * inch, W - 2 * M, 0.45 * inch, 9.8)
    c.showPage()


def page_sign(c):
    header(c, "Acceptance", 7)
    section_title(c, "Authorization", H - 0.95 * inch)
    para(c, "The following space is provided for formal acceptance of the redesigned proposal.", M, H - 1.55 * inch, W - 2 * M, 0.3 * inch, 10.2)
    y = H - 3.05 * inch
    for x, party in [(M, "High Craft General Contracting"), (W / 2 + 0.25 * inch, "TCC - Tianchien Company")]:
        c.setFillColor(SOFT)
        c.roundRect(x, y - 2.6 * inch, 2.55 * inch, 2.55 * inch, 10, stroke=0, fill=1)
        para(c, party, x + 0.22 * inch, y - 0.45 * inch, 2.1 * inch, 0.3 * inch, 11, GREEN, True)
        for i, label in enumerate(["Name and Title", "Signature", "Date", "Company Stamp"]):
            yy = y - 0.85 * inch - i * 0.43 * inch
            c.setStrokeColor(colors.HexColor("#cbd4cc"))
            c.line(x + 0.22 * inch, yy, x + 2.32 * inch, yy)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 7.8)
            c.drawString(x + 0.22 * inch, yy + 0.08 * inch, label)
    para(c, "Confidential: issued only for TCC - Tianchien Company and its authorized representatives.", M, 0.88 * inch, W - 2 * M, 0.22 * inch, 8.5, MUTED, align=TA_CENTER)
    c.showPage()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    missing = [p for p in [ASSETS / "steam-tracing-inspection.png"] if not p.exists()]
    if missing:
        raise FileNotFoundError(missing[0])
    c = canvas.Canvas(str(PDF), pagesize=letter)
    c.setTitle("High Craft Steam Tracing Proposal - Redesigned")
    c.setAuthor("High Craft General Contracting")
    cover(c)
    page_intro(c)
    page_scope(c)
    page_quantities(c)
    page_commercial(c)
    page_terms(c)
    page_sign(c)
    c.save()
    print(PDF)


if __name__ == "__main__":
    main()
