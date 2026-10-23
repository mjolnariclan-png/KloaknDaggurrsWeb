import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OWNER_EMAIL = "mjolnariclan@gmail.com";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.kloakndaggurrs.com",
  "https://kloakndaggurrs.com",
  "https://mjolnariclan-png.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Vary": "Origin",
};

function jsonResponse(status: number, body: Record<string, unknown>, origin: string | null) {
  const allowedOrigins = (Deno.env.get("FORGE_ALLOWED_ORIGINS") ?? DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",").map((value) => value.trim()).filter(Boolean);
  const headers = new Headers(corsHeaders);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function formatDimension(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `${number} in` : "Not provided";
}

function httpUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("FORGE_ALLOWED_ORIGINS") ?? DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",").map((value) => value.trim()).filter(Boolean);

  if (origin && !allowedOrigins.includes(origin)) {
    return jsonResponse(403, { error: "This website is not allowed to submit Forge orders." }, origin);
  }
  if (request.method === "OPTIONS") {
    const headers = new Headers(corsHeaders);
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." }, origin);
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("RESEND_FROM_EMAIL") ?? "Kloak & Daggurrs <onboarding@resend.dev>";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!resendApiKey || !supabaseUrl || !supabaseKey) {
    console.error("Forge email is not configured. Set the RESEND_API_KEY function secret.");
    return jsonResponse(503, { error: "Forge email is not configured yet." }, origin);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "Sign in before sending a Forge order." }, origin);
  }

  let orderId: string;
  try {
    const body = await request.json();
    orderId = body?.orderId;
    if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) {
      return jsonResponse(400, { error: "A valid order ID is required." }, origin);
    }
  } catch {
    return jsonResponse(400, { error: "A valid JSON request is required." }, origin);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonResponse(401, { error: "Your session has expired. Sign in and try again." }, origin);
  }

  const { data: order, error: orderError } = await supabase
    .from("forge_orders")
    .select("id,order_code,user_id,customer_name,email,phone,quantity,printed_by,delivery_date,deadline,source_link,model_files,colors,height_inches,width_inches,length_inches,notes,created_at")
    .eq("id", orderId)
    .eq("user_id", user.id)
    .single();
  if (orderError || !order) {
    console.error("Forge email could not load the authenticated user's order:", orderError?.message);
    return jsonResponse(404, { error: "The saved Forge order could not be found." }, origin);
  }

  const modelPaths = Array.isArray(order.model_files) ? order.model_files : [];
  const modelLinks: string[] = [];
  for (const path of modelPaths) {
    const { data, error } = await supabase.storage
      .from("forge-models")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error || !data?.signedUrl) {
      console.error("Could not create a private Forge model download link:", error?.message);
      return jsonResponse(502, { error: "Could not prepare the uploaded model file links." }, origin);
    }
    modelLinks.push(data.signedUrl);
  }

  const orderCode = String(order.order_code);
  const printedBy = order.printed_by ?? order.deadline;
  const dimensions = `Height: ${formatDimension(order.height_inches)}; Width: ${formatDimension(order.width_inches)}; Length: ${formatDimension(order.length_inches)}`;
  const customerName = String(order.customer_name);
  const customerEmail = String(order.email);
  const sourceLink = typeof order.source_link === "string" ? order.source_link : "";
  const safeSourceLink = httpUrl(sourceLink);
  const notes = String(order.notes ?? "");
  const colors = String(order.colors ?? "Not specified");
  const quantity = String(order.quantity);
  const modelList = modelLinks.length
    ? `<ul>${modelLinks.map((url, index) => `<li><a href="${escapeHtml(url)}">Download model ${index + 1}</a> (link expires in 7 days)</li>`).join("")}</ul>`
    : "<p>No model files uploaded.</p>";

  const ownerHtml = `
    <h1>New Forge order ${escapeHtml(orderCode)}</h1>
    <p><b>Customer:</b> ${escapeHtml(customerName)}</p>
    <p><b>Email:</b> <a href="mailto:${escapeHtml(customerEmail)}">${escapeHtml(customerEmail)}</a></p>
    <p><b>Phone:</b> ${escapeHtml(order.phone || "Not provided")}</p>
    <p><b>Print type:</b> FDM</p>
    <p><b>Quantity:</b> ${escapeHtml(quantity)}</p>
    <p><b>Size:</b> ${escapeHtml(dimensions)}</p>
    <p><b>Colors:</b> ${escapeHtml(colors)}</p>
    <p><b>Requested print-by deadline:</b> ${escapeHtml(printedBy || "Not specified")}</p>
    <p><b>Preferred pickup / mailing date:</b> ${escapeHtml(order.delivery_date || "Not specified")}</p>
    <p><b>Source link:</b> ${safeSourceLink ? `<a href="${escapeHtml(safeSourceLink)}">${escapeHtml(sourceLink)}</a>` : "Not provided or invalid"}</p>
    <p><b>Build brief:</b></p><p>${escapeHtml(notes).replace(/\n/g, "<br>")}</p>
    <p><b>Uploaded models:</b></p>${modelList}`;
  const ownerText = [
    `New Forge order ${orderCode}`,
    `Customer: ${customerName}`,
    `Email: ${customerEmail}`,
    `Phone: ${order.phone || "Not provided"}`,
    "Print type: FDM",
    `Quantity: ${quantity}`,
    dimensions,
    `Colors: ${colors}`,
    `Requested print-by deadline: ${printedBy || "Not specified"}`,
    `Preferred pickup / mailing date: ${order.delivery_date || "Not specified"}`,
    `Source link: ${safeSourceLink || "Not provided or invalid"}`,
    `Build brief: ${notes}`,
    ...modelLinks.map((url, index) => `Model ${index + 1} (expires in 7 days): ${url}`),
  ].join("\n");
  const sendEmail = async (to: string, subject: string, html: string, text: string, key: string, replyTo?: string) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({ from: fromAddress, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Resend rejected Forge email (${response.status}):`, errorBody);
      throw new Error("Resend could not send the Forge email.");
    }
  };

  try {
    await sendEmail(OWNER_EMAIL, `New Forge order ${orderCode}`, ownerHtml, ownerText, `forge-${orderId}-owner`, customerEmail);
    return jsonResponse(200, { success: true, orderCode }, origin);
  } catch {
    return jsonResponse(502, { error: "The order was saved, but an email could not be sent. Please contact the Forge owner." }, origin);
  }
});
