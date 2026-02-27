"""
Builds prompts for SQL generation and result explanation.
"""


def build_sql_prompt(question: str, schema: dict) -> str:
    table = schema["table_name"]

    # Show exact column names (lowercased after upload sanitization)
    col_lines = "\n".join(
        f"  - {c['name']} ({c['type']})" for c in schema["columns"]
    )

    # Show sample data so LLM knows exact values (e.g. 'Yes'/'No' vs 1/0)
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
4. Use DuckDB syntax: use CAST(x AS DOUBLE) for divisions, not :: syntax.
5. Always alias computed columns: SELECT COUNT(*) AS total_count
6. Add LIMIT 100 at the end unless the user explicitly asks for all rows.
7. For YES/NO columns, values are exactly 'Yes' or 'No' (capital first letter).
8. Never use subqueries when a simple GROUP BY works.

USER QUESTION: {question}

SQL (start with SELECT, nothing before it):"""


def build_retry_sql_prompt(question: str, schema: dict, bad_sql: str, error: str) -> str:
    """Used when first SQL attempt failed — feeds the error back to the LLM."""
    table = schema["table_name"]
    col_lines = "\n".join(f"  - {c['name']} ({c['type']})" for c in schema["columns"])

    return f"""You are a DuckDB SQL expert. Your previous SQL query failed. Fix it.

Table: {table}
Columns:
{col_lines}

FAILED SQL:
{bad_sql}

ERROR MESSAGE:
{error}

USER QUESTION: {question}

Write a CORRECTED SQL query. Output ONLY the raw SQL, nothing else — no explanation, no backticks, no markdown.

CORRECTED SQL:"""


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
    """Heuristically decide the best chart type for the result."""
    if not rows:
        return "none"
    if len(rows) == 1 and len(columns) == 1:
        return "kpi"
    if len(rows) == 1:
        return "kpi"
    # 2 columns where second is numeric → bar
    if len(columns) == 2:
        val = list(rows[0].values())[1]
        if isinstance(val, (int, float)):
            # Check if first col is time-like → line
            if any(k.lower() in ("date", "month", "year", "time", "tenure", "period") for k in columns):
                return "line"
            return "bar"
    if len(columns) >= 2:
        return "bar"
    return "table"
