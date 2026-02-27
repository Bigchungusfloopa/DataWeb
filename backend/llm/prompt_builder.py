"""
Builds prompts for question routing, SQL generation, and result explanation.
"""

# ── Live exchange rates (hardcoded; update or fetch dynamically if needed) ───
EXCHANGE_RATES = {
    "INR": 86.5,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 149.5,
    "CAD": 1.36,
    "AUD": 1.53,
}


def _format_history(history: list[dict] = None) -> str:
    if not history:
        return ""
    res = "\nPREVIOUS CONVERSATION HISTORY:\n"
    for msg in history[-4:]:  # last 4 messages to save context
        role = "User" if msg["role"] == "user" else "Assistant"
        res += f"{role}: {msg['content']}\n"
    res += "\n"
    return res


def build_classify_prompt(question: str, schema_available: bool, schema_columns: list[str] = None, history: list[dict] = None) -> str:
    """
    Ask the LLM to classify the question into one of three routes:
      SQL      — needs to query the database
      COMPUTE  — needs to query + do math (conversion, percentage, ratio etc.)
      GENERAL  — does not need the database (pure knowledge / definition / advice)
    """
    col_hint = ""
    if schema_columns:
        col_hint = f"\nAvailable dataset columns: {', '.join(schema_columns)}"
    dataset_hint = "A dataset IS loaded." if schema_available else "No dataset is loaded."

    return f"""{dataset_hint}{col_hint}
{_format_history(history)}
User question: "{question}"

Classify this question into exactly one of these categories:
  SQL     - The question asks for data from the dataset (counts, averages, filters, top-N, distributions, etc.)
  COMPUTE - The question asks for a calculation that combines dataset data with external math (currency conversion, unit conversion, percentage of a known total, etc.)
  GENERAL - The question does not need the dataset at all (definitions, explanations, general knowledge, advice)

Reply with ONLY one word: SQL, COMPUTE, or GENERAL. Nothing else."""


def build_sql_prompt(question: str, schema: dict, history: list[dict] = None) -> str:
    table = schema["table_name"]
    col_lines = "\n".join(
        f"  - {c['name']} ({c['type']})" for c in schema["columns"]
    )
    sample_rows = schema.get("sample", [])
    sample_str = ""
    if sample_rows:
        headers = list(sample_rows[0].keys())
        sample_str = "\nSample data (first 15 rows):\n"
        sample_str += " | ".join(headers) + "\n"
        sample_str += "-" * 60 + "\n"
        for row in sample_rows[:15]:
            sample_str += " | ".join(str(v) for v in row.values()) + "\n"

    return f"""You are a DuckDB SQL expert. Your ONLY job is to output a single SQL SELECT query.

DATABASE INFO:
Table name (exact, case-sensitive): {table}
Columns (use EXACTLY these names, lowercase):
{col_lines}
{sample_str}
STRICT RULES — violating any rule makes your answer wrong:
1. Output THE SQL QUERY ONLY. Zero other text. No explanation, no greeting, no notes.
2. No markdown. No backticks. No ```sql blocks. Just raw SQL starting with SELECT.
3. Use ONLY the column names listed above, spelled exactly as shown (they are all lowercase).
4. Use DuckDB syntax. For division: CAST(x AS DOUBLE). For unsafe string→number: TRY_CAST(col AS DOUBLE).
5. Always alias computed columns: SELECT COUNT(*) AS total_count
6. Add LIMIT 100 at the end unless asked for totals/aggregates (no LIMIT needed for single-row results).
7. For YES/NO columns, values are exactly 'Yes' or 'No' (capital first letter).
8. Never use subqueries when a simple GROUP BY works.
9. If aggregating a column that might be stored as text, wrap it: TRY_CAST(colname AS DOUBLE)
   Example: SELECT SUM(TRY_CAST(totalcharges AS DOUBLE)) AS total_revenue FROM "{table}"
10. ANTI-HALLUCINATION: If the user asks for a column or metric NOT in the column list, DO NOT invent it. Output exactly: SELECT 'Column not found' AS error;
{_format_history(history)}
USER QUESTION: {question}

SQL (start with SELECT, nothing before it):"""


def build_compute_sql_prompt(question: str, schema: dict, history: list[dict] = None) -> str:
    """
    Computation-aware SQL prompt: allows inline math, currency conversion, etc.
    Detects which columns are numeric (or might be stored as VARCHAR numbers)
    so the LLM knows to use TRY_CAST.
    """
    table = schema["table_name"]
    col_lines = "\n".join(f"  - {c['name']} ({c['type']})" for c in schema["columns"])

    # Detect VARCHAR columns that look like they could be numeric from sample data
    varchar_numeric_hints = []
    for col in schema.get("columns", []):
        if col["type"].upper() in ("VARCHAR", "TEXT", "CHAR", "STRING"):
            # Check sample values: if they look numeric, flag this column
            sample_vals = [
                str(row.get(col["name"], "")).strip()
                for row in schema.get("sample", [])[:5]
                if row.get(col["name"]) is not None
            ]
            looks_numeric = sum(
                1 for v in sample_vals if v.replace(".", "", 1).replace("-", "", 1).isdigit()
            )
            if looks_numeric >= 2:
                varchar_numeric_hints.append(col["name"])

    cast_hint = ""
    if varchar_numeric_hints:
        examples = ", ".join(varchar_numeric_hints)
        cast_hint = f"\n⚠️  These columns are stored as text but contain numbers — ALWAYS use TRY_CAST when aggregating them: {examples}"
        cast_hint += f"\n   Example: SELECT ROUND(SUM(TRY_CAST({varchar_numeric_hints[0]} AS DOUBLE)) * 86.5, 2) AS result FROM \"{table}\""

    # Build rate hint
    rate_lines = "\n".join(f"  1 USD = {v} {k}" for k, v in EXCHANGE_RATES.items())

    sample_rows = schema.get("sample", [])
    sample_str = ""
    if sample_rows:
        headers = list(sample_rows[0].keys())
        sample_str = "\nSample data:\n" + " | ".join(headers) + "\n"
        for row in sample_rows[:5]:
            sample_str += " | ".join(str(v) for v in row.values()) + "\n"

    return f"""You are a DuckDB SQL expert. Generate SQL that answers the user's question, including any required math.

DATABASE INFO:
Table: {table}
Columns:
{col_lines}
{sample_str}{cast_hint}

EXCHANGE RATES (use directly in SQL arithmetic as multipliers):
{rate_lines}

RULES:
1. Output ONLY the raw SQL query. No markdown, no backticks, no explanation.
2. You MAY multiply/divide column values inline for conversions or calculations.
3. Use EXACTLY the column names listed above (they are lowercase). DO NOT invent column names like 'revenue' — look at the list above.
4. Always alias computed columns.
5. Use DuckDB's TRY_CAST(col AS DOUBLE) — not CAST — when the column might have non-numeric text values.
6. ROUND results to 2 decimal places.
7. Do NOT add LIMIT for aggregate queries that return a single row.
8. ANTI-HALLUCINATION: If the user asks for a column or metric NOT in the column list, DO NOT invent it. Output exactly: SELECT 'Column not found' AS error;

Good examples:
  Revenue in INR : SELECT ROUND(SUM(TRY_CAST(totalcharges AS DOUBLE)) * 86.5, 2) AS total_revenue_inr FROM "{table}"
  Avg charge EUR : SELECT ROUND(AVG(TRY_CAST(monthlycharges AS DOUBLE)) * 0.92, 2) AS avg_monthly_eur FROM "{table}"
{_format_history(history)}
USER QUESTION: {question}

SQL:"""


def build_retry_sql_prompt(question: str, schema: dict, bad_sql: str, error: str) -> str:
    table = schema["table_name"]
    col_lines = "\n".join(f"  - {c['name']} ({c['type']})" for c in schema["columns"])

    # Identify VARCHAR columns that look numeric (likely cause of type errors)
    varchar_numeric = [
        c["name"] for c in schema.get("columns", [])
        if c["type"].upper() in ("VARCHAR", "TEXT", "CHAR", "STRING")
    ]
    cast_hint = ""
    if varchar_numeric:
        cast_hint = (
            f"\n⚠️  Common fix: these columns are VARCHAR — wrap numeric aggregations with TRY_CAST:\n"
            + "\n".join(f"   TRY_CAST({c} AS DOUBLE)" for c in varchar_numeric[:4])
        )

    return f"""You are a DuckDB SQL expert. Your previous SQL failed. Output ONLY the corrected SQL.

Table: {table}
Valid columns ONLY:
{col_lines}
{cast_hint}

FAILED SQL:
{bad_sql}

ERROR MESSAGE:
{error}

USER QUESTION: {question}

FIX RULES:
- Output ONLY the corrected SQL. No explanation. No markdown. No backticks.
- If the error mentions "Cannot execute scalar expression" or "Binder" or type errors → use TRY_CAST(col AS DOUBLE) for numeric operations.
- Only use column names from the list above. Never invent column names.
- Use DuckDB syntax only (TRY_CAST, not ::DOUBLE or SAFE_CAST).

CORRECTED SQL:"""


def build_general_answer_prompt(question: str, schema: dict = None, history: list[dict] = None) -> str:
    """For questions that don't require a database query."""
    context = ""
    if schema:
        col_names = ", ".join(c["name"] for c in schema["columns"])
        context = f"\n\nContext: The user has a dataset called '{schema['table_name']}' with {schema['row_count']} rows and columns: {col_names}."

    return f"""You are a helpful data analyst assistant.{context}
{_format_history(history)}
User question: "{question}"

Answer this question clearly and concisely in plain English. 
Be specific, use bullet points if listing multiple items.
If the question involves a currency conversion or calculation, show the working.
Do NOT use markdown headers. Keep the response under 5 sentences unless a list is needed.
IMPORTANT ANTI-HALLUCINATION RULE: Answer ONLY based on the provided context or general knowledge about data analytics. Do not invent information about the dataset. If you cannot answer based on the data, state 'I do not have enough specific data to answer this'."""


def build_explanation_prompt(question: str, sql: str, results: list[dict]) -> str:
    result_preview = ""
    if results:
        headers = list(results[0].keys())
        result_preview = " | ".join(headers) + "\n"
        for row in results[:10]:
            result_preview += " | ".join(
                str(round(v, 2) if isinstance(v, float) else v) for v in row.values()
            ) + "\n"

    return f"""You are a friendly data analyst helping a non-technical business user understand data.

The user asked: "{question}"
Query results:
{result_preview}

Write 1-3 clear sentences explaining what these numbers mean in plain English.
Use specific numbers from the results. Be direct and concrete.
Do NOT mention SQL, databases, queries, or technical terms.
Do NOT use markdown. Plain text only."""


def suggest_chart_type(columns: list[str], rows: list[dict]) -> str:
    if not rows:
        return "none"
    if len(rows) == 1:
        return "kpi"
    if len(columns) == 2:
        val = list(rows[0].values())[1]
        if isinstance(val, (int, float)):
            if any(k.lower() in ("date", "month", "year", "time", "tenure", "period") for k in columns):
                return "line"
            return "bar"
    if len(columns) >= 2:
        return "bar"
    return "table"
