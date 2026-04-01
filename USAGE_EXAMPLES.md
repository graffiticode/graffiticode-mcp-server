# Graffiticode MCP Server — Usage Examples

These examples demonstrate the core workflows for the Graffiticode MCP server. Each can be reproduced by connecting to `https://mcp.graffiticode.org/mcp` from any MCP-compatible client.

---

## Example 1: Create a Concept Web Assessment

This example shows the discover → create → iterate workflow using language L0169 (interactive concept web assessments).

**Step 1: Discover available languages**

```
Tool: list_languages
Args: { "search": "assessment" }
```

Response:
```json
{
  "languages": [
    {
      "id": "L0169",
      "name": "L0169",
      "description": "Interactive concept web assessment diagrams",
      "category": "data"
    }
  ]
}
```

**Step 2: Create the assessment**

```
Tool: create_item
Args: {
  "language": "L0169",
  "description": "Create a concept web assessment about photosynthesis. Put Photosynthesis at the center, with connected concepts: Sunlight, Carbon Dioxide, Water, Glucose, and Oxygen. Include assessment on all connections."
}
```

Response includes `item_id`, compiled `data` for rendering, and `react_usage` instructions.

**Step 3: Iterate on the result**

```
Tool: update_item
Args: {
  "item_id": "<item_id from step 2>",
  "modification": "Add Chlorophyll as a connected concept between Sunlight and Photosynthesis. Use a dark theme."
}
```

The server maintains conversation history, so the language AI knows the full context of what's been built.

---

## Example 2: Build a Spreadsheet

This example shows creating and modifying a spreadsheet using language L0166.

**Step 1: Get language details**

```
Tool: get_language_info
Args: { "language": "L0166" }
```

Returns the language description, usage guide URL, spec URL, and React component instructions.

**Step 2: Create a spreadsheet**

```
Tool: create_item
Args: {
  "language": "L0166",
  "description": "Create a monthly budget spreadsheet with columns for Category, Budgeted Amount, Actual Amount, and Difference. Include rows for Rent, Groceries, Utilities, Transportation, and Entertainment. Add a totals row at the bottom with SUM formulas."
}
```

**Step 3: Update the spreadsheet**

```
Tool: update_item
Args: {
  "item_id": "<item_id from step 2>",
  "modification": "Add a Savings row after Entertainment with a budgeted amount of 500. Make the header row blue."
}
```

---

## Example 3: Create Flashcards

This example shows creating study materials using language L0159.

**Step 1: Discover the flashcard language**

```
Tool: list_languages
Args: { "search": "flashcard" }
```

Response:
```json
{
  "languages": [
    {
      "id": "L0159",
      "name": "L0159",
      "description": "Flashcards, Match and Memory card games",
      "category": "data"
    }
  ]
}
```

**Step 2: Create a flashcard set**

```
Tool: create_item
Args: {
  "language": "L0159",
  "description": "Create a set of 8 flashcards for learning Spanish greetings. Include: Hello/Hola, Goodbye/Adiós, Good morning/Buenos días, Good night/Buenas noches, Please/Por favor, Thank you/Gracias, How are you?/¿Cómo estás?, Nice to meet you/Mucho gusto."
}
```

**Step 3: Retrieve the item later**

```
Tool: get_item
Args: { "item_id": "<item_id from step 2>" }
```

Returns the full item data including code, compiled output, timestamps, and React rendering instructions.

---

## Example 4: Explore the Language Catalog

This example shows how to browse all available languages without a specific goal.

```
Tool: list_languages
Args: {}
```

Returns the full catalog of available languages with IDs, names, descriptions, and categories. The catalog is dynamic and grows as new Graffiticode languages are added.

Follow up with `get_language_info` on any language to see its full documentation, spec URL, and usage guide.
