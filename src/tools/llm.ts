const ROUTER_API_URL = "https://router.requesty.ai/v1/chat/completions";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/MODEL_NAME:generateContent`;

const systemMessage = "You are a professional logistics data analyst tasked with standardizing logistics data " +
    "from various external providers into a consistent format based on specific rules. I will provide two datasets:" +
    "A standardized status & what list detailing major and minor events. Major event codes includes 3000, 3100, 3200, 3300, 3400 and 3500. " +
    "Minor event codes include 3050, 3150, 3250, 3350 and 3450, All other event codes are classified as non-critical codes." +
    "Shipment data containing raw routing data from external providers and their transformed status & what outputs. " +
    "Each routing data point includes an input (raw data from the provider) and an output (converted status & what)." +
    "Your task is to analyse events in the waybill and ensure all major events are present, " +
    "you need to output the missing major events in JSON format. The JSON output should include two attribute: one is status code, the other is what.";

export async function checkStatusViaRequesty(data: Array<Record<string, unknown>>, jsonStatusCode: Record<string, unknown>): Promise<void> {
    const userPrompt = `The standardized status & what list is: ${JSON.stringify(jsonStatusCode)}` +
        `The shipment data is: ${JSON.stringify(data)},`;

    const messages: Array<{ role: string; content: string }> = [
        {role: "system", content: systemMessage},
        {role: "user", content: userPrompt},
    ];

    // anthropic/claude-3-5-haiku-latest
    // deepinfra/deepseek-ai/DeepSeek-V3.1
    const completion = await callLLMViaRequesty(
        "deepinfra/deepseek-ai/DeepSeek-V3",
        messages,
    );
    console.log("Result:", completion);
}

export async function checkStatusViaGemini(data: Array<Record<string, unknown>>, jsonStatusCode: Record<string, unknown>): Promise<void> {
    const userPrompt = `The standardized status & what list is: ${JSON.stringify(jsonStatusCode)}` +
        `The shipment data is: ${JSON.stringify(data)},`;

    const completion = await callGemini(
        "gemini-2.5-flash",
        systemMessage,
        userPrompt
    );
    console.log("Result:", completion);
}

async function callLLMViaRequesty(model: string, messages: Array<{ role: string; content: string }>): Promise<string> {
    const routerApiKey = Deno.env.get("ROUTER_API_KEY");

    if (!routerApiKey) {
        throw new Error("ROUTER_API_KEY environment variable is not set");
    }

    const response = await fetch(ROUTER_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${routerApiKey}`,
        },
        body: JSON.stringify({
            model: model,
            messages: messages,
        }),
    });

    const data = await getLLMResponse(response);
    const choices = data?.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content !== "string") {
        throw new Error("Unexpected LLM response: missing choices[0].message.content");
    }

    return content.trim();
}

async function callGemini(model: string, systemIntruction: string, userMessage: string): Promise<string> {
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiApiKey) {
        throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    const apiUrl = GEMINI_API_URL.replace("MODEL_NAME", model) + "?key=" + geminiApiKey;
    const contents: Array<Record<string, unknown>> = [
        {
            role: "user",
            parts: [
                {text: userMessage}
            ]
        },
    ];
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            system_instruction: { parts: [{ text: systemIntruction }] },
            contents: contents,
        }),
    });

    const data = await getLLMResponse(response);
    const candidates = data?.candidates as Array<Record<string, unknown>> | undefined;
    const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, unknown>> | undefined;
    const text = parts?.[0]?.text;
    if (typeof text !== "string") {
        throw new Error("Unexpected Gemini response: missing candidates[0].content.parts[0].text");
    }
    return text.trim();
}

async function getLLMResponse(response: Response): Promise<Record<string, unknown>>  {
    if (!response.ok) {
        let errorMessage;
        try {
            const errorData = await response.json();
            errorMessage = errorData?.error?.message ?? "";
        } catch {
            errorMessage = await response.text().catch(() => "");
        }
        throw new Error(`HTTP error! status: ${response.status} : ${errorMessage}`);
    }
    return await response.json();
}