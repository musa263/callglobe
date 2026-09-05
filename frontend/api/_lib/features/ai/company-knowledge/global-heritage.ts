/**
 * What the receptionist knows about Global Heritage Systems LTD, taken from
 * www.ghsl.us on 5 September 2026. The site is rendered in the browser, so it
 * cannot be crawled from a serverless function; the facts are kept here and
 * used whenever the tenant's own knowledge box in the admin is empty. Anything
 * typed into that box replaces this text.
 *
 * Written for a phone: plain sentences the model can read aloud or draw from,
 * with the contact details exactly as published.
 */
export const globalHeritageKnowledge = `
Company: Global Heritage Systems LTD, usually called GHSL. Website www.ghsl.us.
An industrial solutions provider based in Jubail Industrial City, Saudi Arabia (Al-Raifi, Jubail), supporting Saudi Arabia's industrial growth in line with Vision 2030. Over 500 projects delivered, 7 business divisions, 20+ years of combined expertise.

Contact: phone +966 53 545 8080, email info@ghsl.us. Office in Jubail, close to Saudi Arabia's industrial corridor. Enquiries can also be sent through the contact form on the website; the team routes each enquiry to the right service team.

Who we serve: oil and gas, petrochemical, refining, power, energy, construction and manufacturing clients, mainly in the Eastern Province and across Saudi Arabia.

What we do — business segments:
- Industrial services: project delivery, maintenance, environmental services, electrical and instrumentation, equipment support, manufacturing and qualified field teams under one operating standard, with a delivery method of scope review, method planning, resource mobilisation, safe execution and quality close-out.
- Projects (EPC and LSTK): integrated engineering, procurement and construction, lump-sum turnkey work, civil industrial construction, piping, equipment installation and rope-access delivery.
- Plant maintenance and turnaround: planned shutdowns, emergency maintenance, turnaround execution, chemical cleaning of heat exchangers, piping and vessels, hydrojetting, steam tracing, steam trap surveys, leak sealing, tank maintenance, and pre-commissioning and commissioning support.
- Bolt torquing and tensioning: controlled bolting for critical flanges and pressure equipment, flange joint integrity, and bolting documentation for shutdowns.
- Electrical and instrumentation: power systems, substations, SCADA, automation, instrumentation, cable health and energy management.
- Environmental services: VOC (volatile organic compound) emission assessment, activated-carbon adsorption and other treatment technologies, turnkey environmental control systems from survey and engineering to installation, commissioning and maintenance, and compliance support. Waste management including collection, disposal and recycling.
- Equipment rental: heavy equipment for construction, maintenance and turnarounds; hydrojetting equipment; temporary site facilities such as modular offices, cabins, blast-resistant cabins and welfare units; summer cooling and air-conditioning rental for field teams; dewatering; and temporary power and energy services.
- Industrial support: qualified manpower, operations support and field teams for petrochemical, manufacturing and infrastructure sites.
- Renewable energy: solar PV power generation projects for industrial and commercial clients, and carbon-credit offset programmes customers can buy to offset residual greenhouse-gas emissions.
- Manufacturing: Thermo-Track is GHSL's valve division, producing valves and steam traps — mechanical inverted-bucket traps, ball-float traps, thermodynamic disc traps and bellows-sealed valves. Digital products live at thermotrack.ghsl.us.

Careers: GHSL hires professionals who care about technical excellence, safety and accountability. Open roles at the time of writing, all full-time in Jubail Industrial City: Trainee Engineer (entry level, engineering graduate), Sales Engineer (5+ years in Jubail industrial services sales) and Business Development Lead (5+ years). Candidates apply on the Careers page of www.ghsl.us with a CV (PDF or Word, up to 3 MB); the team reviews every profile. A caller asking about a job can be pointed to the careers page or have a message taken for the hiring team.

Vision: to be the leading and most trusted industrial services partner, with integrity, professionalism and world-class delivery. Mission: dependable industrial solutions that improve safety, efficiency and sustainability for clients across Saudi Arabia.

If a caller asks for prices, quotations, project timelines or anything not covered here, do not guess: offer to take their details and have the right team call back, or put them through if a person is available.
`.trim();

/** Companies whose receptionist has a shipped brief when the admin's knowledge box is empty. */
export function shippedCompanyKnowledge(companyName: string): string {
  const name = (companyName || '').trim().toLowerCase();
  if (/global heritage|ghsl/.test(name)) return globalHeritageKnowledge;
  return '';
}
