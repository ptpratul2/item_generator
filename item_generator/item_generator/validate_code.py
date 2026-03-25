import frappe
from frappe.utils import strip_html

@frappe.whitelist()
def get_item_suggestions(txt):
    if not txt or len(txt) < 2:
        return []

    txt = " ".join(txt.lower().strip().split())
    words = txt.split()

    conditions = []
    values = []

    for word in words:
        escaped = word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        # Search in name, item_code, and description
        conditions.append("(item_code LIKE %s OR item_name LIKE %s OR description LIKE %s)")
        values.extend([pattern, pattern, pattern])

    where_clause = " AND ".join(conditions)

    query = f"""
        SELECT item_code, item_name, description
        FROM tabItem
        WHERE disabled = 0
        AND {where_clause}
        ORDER BY modified DESC
        """ 

    items = frappe.db.sql(query, tuple(values), as_dict=True)

    suggestions = []
    seen_codes = set() 

    for d in items:
        item_code = (d.get("item_code") or "").strip()
        
        if item_code in seen_codes:
            continue
        seen_codes.add(item_code)

        i_name = (d.get("item_name") or "").replace('|', '-').strip()
        
        clean_desc = strip_html(d.get("description") or "")
        clean_desc = clean_desc.replace('|', '-').replace('\n', ' ').replace('\r', ' ').strip()
        display_desc = clean_desc[:70] if clean_desc else ""

        # --- FINAL LABEL LOGIC ---
        parts = [item_code]
        
        if i_name and i_name.lower() != item_code.lower():
            parts.append(i_name)
        
        if display_desc:
            desc_low = display_desc.lower()
            if desc_low != item_code.lower() and desc_low != i_name.lower():
                parts.append(display_desc)
        
        # Sabko pipe "|" se join kar dein
        label = " | ".join(parts)
        suggestions.append(label)

    return suggestions