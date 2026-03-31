const functions = require("firebase-functions");
const cheerio = require("cheerio");
const Anthropic = require("@anthropic-ai/sdk");
// Node 22 has built-in fetch

// Extract recipe data from a URL using Schema.org JSON-LD
exports.scrapeRecipe = functions.https.onCall(async (data, context) => {
  const url = data.url;
  if (!url) {
    throw new functions.https.HttpsError("invalid-argument", "URL is required");
  }

  // Basic URL validation
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new functions.https.HttpsError("invalid-argument", "Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new functions.https.HttpsError("invalid-argument", "URL must be http or https");
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`);
      console.error("Response headers:", JSON.stringify(Object.fromEntries(response.headers.entries())));
      throw new functions.https.HttpsError("not-found", `Could not fetch URL (${response.status}). The site may be blocking automated requests.`);
    }

    const html = await response.text();
    const recipe = extractRecipe(html, url);

    if (!recipe) {
      throw new functions.https.HttpsError("not-found", "No recipe found on that page. The site may not use standard recipe markup.");
    }

    return recipe;
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError("internal", "Failed to fetch recipe: " + err.message);
  }
});

function extractRecipe(html, sourceUrl) {
  const $ = cheerio.load(html);

  // Strategy 1: JSON-LD (most common and most reliable)
  const jsonLdScripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLdScripts.length; i++) {
    try {
      const data = JSON.parse($(jsonLdScripts[i]).html());
      const recipe = findRecipeInJsonLd(data);
      if (recipe) return normalizeJsonLdRecipe(recipe, sourceUrl);
    } catch {
      // Skip malformed JSON-LD
    }
  }

  // Strategy 2: Microdata (itemtype="http://schema.org/Recipe")
  const microdataEl = $('[itemtype*="schema.org/Recipe"]').first();
  if (microdataEl.length) {
    return extractMicrodata($, microdataEl, sourceUrl);
  }

  // Strategy 3: Fallback — scan page content for recipe-like sections
  const title = $("h1").first().text().trim() ||
                $('meta[property="og:title"]').attr("content") ||
                $("title").text().trim();

  if (title) {
    const { ingredients, directions } = extractFromContent($);
    return {
      name: title,
      ingredients,
      directions,
      description: $('meta[property="og:description"]').attr("content") || "",
      source_url: sourceUrl,
      source: new URL(sourceUrl).hostname,
      partial: !ingredients && !directions,
    };
  }

  return null;
}

function findRecipeInJsonLd(data) {
  if (!data) return null;

  // Direct Recipe object
  if (data["@type"] === "Recipe") return data;

  // Array of types (some sites use ["Article", "Recipe"])
  if (Array.isArray(data["@type"]) && data["@type"].includes("Recipe")) return data;

  // Nested in @graph
  if (data["@graph"] && Array.isArray(data["@graph"])) {
    for (const item of data["@graph"]) {
      const found = findRecipeInJsonLd(item);
      if (found) return found;
    }
  }

  // Array of items
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInJsonLd(item);
      if (found) return found;
    }
  }

  return null;
}

function normalizeJsonLdRecipe(r, sourceUrl) {
  return {
    name: r.name || "",
    ingredients: normalizeList(r.recipeIngredient),
    directions: normalizeInstructions(r.recipeInstructions),
    description: r.description || "",
    prep_time: parseDuration(r.prepTime),
    cook_time: parseDuration(r.cookTime),
    total_time: parseDuration(r.totalTime),
    servings: r.recipeYield
      ? (Array.isArray(r.recipeYield) ? r.recipeYield[0] : String(r.recipeYield))
      : "",
    categories: normalizeCategories(r.recipeCategory, r.recipeCuisine),
    source_url: sourceUrl,
    source: r.author
      ? (typeof r.author === "string" ? r.author : (r.author.name || r.author[0]?.name || ""))
      : new URL(sourceUrl).hostname,
    image_url: r.image
      ? (typeof r.image === "string" ? r.image : (r.image.url || (Array.isArray(r.image) ? r.image[0] : "")))
      : "",
    notes: r.notes || "",
  };
}

function extractMicrodata($, el, sourceUrl) {
  const prop = (name) => {
    const found = el.find(`[itemprop="${name}"]`).first();
    return found.attr("content") || found.text().trim();
  };

  const ingredients = [];
  el.find('[itemprop="recipeIngredient"], [itemprop="ingredients"]').each((_, e) => {
    const text = $(e).text().trim();
    if (text) ingredients.push(text);
  });

  const steps = [];
  el.find('[itemprop="recipeInstructions"]').each((_, e) => {
    const text = $(e).text().trim();
    if (text) steps.push(text);
  });

  return {
    name: prop("name"),
    ingredients: ingredients.join("\n"),
    directions: steps.join("\n"),
    description: prop("description"),
    prep_time: parseDuration(prop("prepTime")),
    cook_time: parseDuration(prop("cookTime")),
    total_time: parseDuration(prop("totalTime")),
    servings: prop("recipeYield"),
    categories: [],
    source_url: sourceUrl,
    source: prop("author") || new URL(sourceUrl).hostname,
    image_url: "",
    notes: "",
  };
}

function normalizeList(arr) {
  if (!arr) return "";
  if (typeof arr === "string") return arr;
  if (Array.isArray(arr)) return arr.map(s => (typeof s === "string" ? s : s.text || s.name || "").trim()).filter(Boolean).join("\n");
  return "";
}

function normalizeInstructions(instructions) {
  if (!instructions) return "";
  if (typeof instructions === "string") return instructions;
  if (Array.isArray(instructions)) {
    const steps = [];
    for (const item of instructions) {
      if (typeof item === "string") {
        steps.push(item.trim());
      } else if (item["@type"] === "HowToStep") {
        steps.push(item.text?.trim() || "");
      } else if (item["@type"] === "HowToSection") {
        if (item.name) steps.push(`\n${item.name}:`);
        if (Array.isArray(item.itemListElement)) {
          for (const sub of item.itemListElement) {
            steps.push(typeof sub === "string" ? sub.trim() : (sub.text?.trim() || ""));
          }
        }
      }
    }
    return steps.filter(Boolean).join("\n");
  }
  return "";
}

function parseDuration(iso) {
  if (!iso) return "";
  // Parse ISO 8601 duration like PT30M, PT1H15M
  const match = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return String(iso);
  const parts = [];
  if (match[1]) parts.push(`${match[1]} hr`);
  if (match[2]) parts.push(`${match[2]} min`);
  if (match[3]) parts.push(`${match[3]} sec`);
  return parts.join(" ") || String(iso);
}

function normalizeCategories(category, cuisine) {
  const cats = [];
  if (category) {
    if (Array.isArray(category)) cats.push(...category);
    else cats.push(...String(category).split(",").map(s => s.trim()));
  }
  if (cuisine) {
    if (Array.isArray(cuisine)) cats.push(...cuisine);
    else cats.push(...String(cuisine).split(",").map(s => s.trim()));
  }
  return cats.filter(Boolean);
}

// === Scan Recipe from Photo ===

exports.scanRecipe = functions.runWith({ secrets: ["ANTHROPIC_API_KEY"] }).https.onCall(async (data, context) => {
  const { imageBase64, mimeType } = data;

  if (!imageBase64) {
    throw new functions.https.HttpsError("invalid-argument", "Image data is required");
  }

  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const mediaType = mimeType || "image/jpeg";
  if (!validTypes.includes(mediaType)) {
    throw new functions.https.HttpsError("invalid-argument", "Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
  }

  // Check size — base64 is ~33% larger than raw, so 10MB base64 ≈ 7.5MB image
  if (imageBase64.length > 10 * 1024 * 1024) {
    throw new functions.https.HttpsError("invalid-argument", "Image is too large. Please use a smaller photo.");
  }

  try {
    const client = new Anthropic();

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: `Extract the recipe from this image. Return ONLY a JSON object with these fields:
{
  "name": "Recipe title",
  "ingredients": "Each ingredient on its own line, including quantities",
  "directions": "Each step on its own line, numbered",
  "servings": "Number of servings if shown",
  "prep_time": "Prep time if shown",
  "cook_time": "Cook time if shown",
  "categories": ["array", "of", "categories"],
  "notes": "Any extra notes from the recipe"
}

Rules:
- Include exact quantities and measurements for ingredients
- Keep ingredient lines simple: "2 cups flour" not "2 cups all-purpose flour, sifted (see note 3)"
- Number the direction steps
- If a field isn't visible in the image, use an empty string or empty array
- Return ONLY the JSON object, no other text`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].text.trim();

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const recipe = JSON.parse(jsonStr);

    if (!recipe.name) {
      throw new functions.https.HttpsError("not-found", "Couldn't read a recipe from this image. Try a clearer photo.");
    }

    return {
      name: recipe.name || "",
      ingredients: recipe.ingredients || "",
      directions: recipe.directions || "",
      servings: recipe.servings || "",
      prep_time: recipe.prep_time || "",
      cook_time: recipe.cook_time || "",
      categories: recipe.categories || [],
      notes: recipe.notes || "",
      source: "Photo scan",
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (err instanceof SyntaxError) {
      throw new functions.https.HttpsError("internal", "Couldn't parse the recipe from this image. Try a clearer photo.");
    }
    throw new functions.https.HttpsError("internal", "Failed to scan recipe: " + err.message);
  }
});

// === Parse Recipe from Pasted Text ===

exports.parseRecipeText = functions.runWith({ secrets: ["ANTHROPIC_API_KEY"] }).https.onCall(async (data, context) => {
  const { text } = data;

  if (!text || !text.trim()) {
    throw new functions.https.HttpsError("invalid-argument", "Recipe text is required");
  }

  if (text.length > 20000) {
    throw new functions.https.HttpsError("invalid-argument", "Text is too long. Please paste just the recipe.");
  }

  try {
    const client = new Anthropic();

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Extract the recipe from this text. Return ONLY a JSON object with these fields:
{
  "name": "Recipe title",
  "ingredients": "Each ingredient on its own line, including quantities",
  "directions": "Each step on its own line, numbered",
  "servings": "Number of servings if shown",
  "prep_time": "Prep time if shown",
  "cook_time": "Cook time if shown",
  "categories": ["array", "of", "categories"],
  "notes": "Any extra notes from the recipe"
}

Rules:
- Include exact quantities and measurements for ingredients
- Keep ingredient lines simple: "2 cups flour" not "2 cups all-purpose flour, sifted (see note 3)"
- Number the direction steps
- If a field isn't in the text, use an empty string or empty array
- Return ONLY the JSON object, no other text

Here is the recipe text:

${text}`,
        },
      ],
    });

    const responseText = response.content[0].text.trim();

    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const recipe = JSON.parse(jsonStr);

    if (!recipe.name) {
      throw new functions.https.HttpsError("not-found", "Couldn't find a recipe in that text. Try pasting just the recipe.");
    }

    return {
      name: recipe.name || "",
      ingredients: recipe.ingredients || "",
      directions: recipe.directions || "",
      servings: recipe.servings || "",
      prep_time: recipe.prep_time || "",
      cook_time: recipe.cook_time || "",
      categories: recipe.categories || [],
      notes: recipe.notes || "",
      source: "Pasted text",
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (err instanceof SyntaxError) {
      throw new functions.https.HttpsError("internal", "Couldn't parse a recipe from that text. Try reformatting it.");
    }
    throw new functions.https.HttpsError("internal", "Failed to parse recipe: " + err.message);
  }
});

// Fallback: scan page HTML for ingredient/direction sections
function extractFromContent($) {
  let ingredients = "";
  let directions = "";

  // Look for headings that say "Ingredients" or "Directions"/"Instructions"
  const headings = $("h1, h2, h3, h4, h5, h6, strong, b");

  headings.each((_, el) => {
    const text = $(el).text().trim().toLowerCase();

    if (/^ingredients/.test(text) && !ingredients) {
      ingredients = grabContentAfter($, el);
    }
    if (/^(directions|instructions|method|steps|preparation|how to make)/.test(text) && !directions) {
      directions = grabContentAfter($, el);
    }
  });

  return { ingredients, directions };
}

function grabContentAfter($, headingEl) {
  const lines = [];
  let el = $(headingEl).parent().next();

  // Walk siblings until we hit another heading or run out
  for (let i = 0; i < 30 && el.length; i++) {
    const tag = el.prop("tagName")?.toLowerCase();

    // Stop at the next heading
    if (tag && /^h[1-6]$/.test(tag)) break;

    // If it's a list, grab each item
    if (tag === "ul" || tag === "ol") {
      el.find("li").each((_, li) => {
        const t = $(li).text().trim();
        if (t) lines.push(t);
      });
      el = el.next();
      continue;
    }

    // Otherwise grab paragraph/div text
    const t = el.text().trim();
    if (t) lines.push(t);
    el = el.next();
  }

  return lines.join("\n");
}
