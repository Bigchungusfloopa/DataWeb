"""
Ollama HTTP client for Llama 3.1 8B.
Calls the local Ollama server at http://localhost:11434.
"""
import httpx
import re

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.1:8b"
TIMEOUT = httpx.Timeout(120.0)


async def _call_ollama(prompt: str, temperature: float = 0.0) -> str:
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": 512,
            "stop": ["\n\n\n"],   # don't stop on single newlines (SQL can be multiline)
        },
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(OLLAMA_URL, json=payload)
        response.raise_for_status()
        return response.json().get("response", "").strip()


async def generate_sql(prompt: str) -> str:
    """Generate SQL and return a clean, executable SQL string."""
    raw = await _call_ollama(prompt, temperature=0.0)
    return _clean_sql(raw)


async def explain_results(prompt: str) -> str:
    """Generate a friendly natural language explanation."""
    return await _call_ollama(prompt, temperature=0.3)


async def check_ollama_health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
            r = await client.get("http://localhost:11434/api/tags")
            return r.status_code == 200
    except Exception:
        return False


def _clean_sql(raw: str) -> str:
    """
    Aggressively clean LLM output to extract just the SQL statement.
    Handles: markdown fences, leading explanation text, trailing notes.
    """
    if not raw:
        return ""

    # 1. Extract from ```sql ... ``` code fence if present
    fence_match = re.search(r"```(?:sql)?\s*(.*?)```", raw, re.IGNORECASE | re.DOTALL)
    if fence_match:
        raw = fence_match.group(1).strip()

    # 2. Strip inline backticks
    raw = raw.replace("`", "").strip()

    # 3. Find the first SELECT/WITH/INSERT keyword — discard everything before it
    match = re.search(r"\b(SELECT|WITH|INSERT|UPDATE|DELETE)\b", raw, re.IGNORECASE)
    if match:
        raw = raw[match.start():]

    # 4. If there are multiple statements, take only the first
    # Split on semicolon then take the first non-empty part
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    if parts:
        raw = parts[0]

    # 5. Remove trailing lines that look like explanations (don't start with SQL keywords)
    sql_lines = []
    for line in raw.splitlines():
        stripped = line.strip()
        # Stop collecting if line looks like commentary (starts with -- is ok, that's a SQL comment)
        if stripped and not stripped.startswith("--"):
            # Check if it looks like prose (starts with a capital letter followed by space, not a SQL keyword)
            sql_keywords = {"SELECT", "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "LIMIT",
                            "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR",
                            "CASE", "WHEN", "THEN", "ELSE", "END", "AS", "BY", "WITH",
                            "UNION", "INTERSECT", "EXCEPT", "CAST", "COUNT", "SUM",
                            "AVG", "MIN", "MAX", "DISTINCT", "NOT", "NULL", "IS", "IN"}
            first_word = stripped.split()[0].upper() if stripped.split() else ""
            if sql_lines and first_word not in sql_keywords and re.match(r'^[A-Z][a-z]', stripped):
                break  # Looks like an explanation sentence — stop here
        sql_lines.append(line)

    raw = "\n".join(sql_lines).strip()

    return raw
