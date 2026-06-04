#!/usr/bin/env python3
"""
Parse index.html and extract all recruitment entries into companies.json
Each entry: company_name, locations, tags, target_audience, job_positions, description, apply_url, website_url
"""
import re
import json
import os

os.chdir(r'd:\招聘信息')

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

companies = []

# Find all data rows (with row-num, excluding header-row)
# Each row: <div class="row"><span class="row-num">NN</span>...content...</div>
row_pattern = re.compile(
    r'<div class="row">\s*<span class="row-num">(\d+)</span>'
    r'(.*?)'
    r'</div>\s*(?=<div class="row">|<div class="footer">|</div>\s*</div>|\s*</div>\s*$)',
    re.DOTALL
)

for match in row_pattern.finditer(html):
    row_num = int(match.group(1))
    row_html = match.group(0)

    if 'header-row' in row_html:
        continue

    # Extract company name
    company_match = re.search(r'<span class="row-company">(.*?)</span>', row_html)
    company_name = company_match.group(1).strip() if company_match else ''

    # Extract location
    loc_match = re.search(r'<span class="row-loc">📍(.*?)</span>', row_html)
    locations = loc_match.group(1).strip() if loc_match else ''

    # Extract tags
    tags = []
    for tag_match in re.finditer(r'<span class="tag[^"]*">(.*?)</span>', row_html):
        tag_text = tag_match.group(1).strip()
        tags.append(tag_text)

    # Extract info items
    info_items = {}
    for info_match in re.finditer(
        r'<span class="info-item">\s*<strong>([^：:]*)[：:]\s*</strong>(.*?)</span>',
        row_html
    ):
        key = info_match.group(1).strip()
        value = info_match.group(2).strip()
        info_items[key] = value

    # Extract special info items (with color style)
    for info_match in re.finditer(
        r'<span class="info-item"\s+style="[^"]*">(.*?)</span>',
        row_html
    ):
        text = info_match.group(1).strip()
        if text and text not in info_items.values():
            info_items['备注'] = text

    target_audience = info_items.get('面向', '')
    job_positions = info_items.get('岗', '')
    description = info_items.get('备注', '')

    # Extract URLs
    apply_url = ''
    website_url = ''

    primary_match = re.search(r'<a class="btn-primary"\s+href="([^"]*)"', row_html)
    if primary_match:
        apply_url = primary_match.group(1)

    outline_match = re.search(r'<a class="btn-outline"\s+href="([^"]*)"', row_html)
    if outline_match:
        website_url = outline_match.group(1)

    # Also capture the btn-primary text
    primary_text_match = re.search(
        r'<a class="btn-primary"\s+href="[^"]*"[^>]*>(.*?)</a>', row_html
    )
    apply_text = primary_text_match.group(1).strip() if primary_text_match else ''

    outline_text_match = re.search(
        r'<a class="btn-outline"\s+href="[^"]*"[^>]*>(.*?)</a>', row_html
    )
    website_text = outline_text_match.group(1).strip() if outline_text_match else ''

    company = {
        'row_num': row_num,
        'company_name': company_name,
        'locations': locations,
        'tags_json': json.dumps(tags, ensure_ascii=False),
        'tags': tags,
        'target_audience': target_audience,
        'job_positions': job_positions,
        'description': description,
        'apply_url': apply_url,
        'apply_text': apply_text,
        'website_url': website_url,
        'website_text': website_text,
    }

    companies.append(company)

print(f"Extracted {len(companies)} companies")

# Save as JSON
with open('data_migration/companies.json', 'w', encoding='utf-8') as f:
    json.dump(companies, f, ensure_ascii=False, indent=2)

# Also generate SQL insert statements
sql_lines = []
for c in companies:
    # Escape single quotes for SQL
    def esc(s):
        return s.replace("'", "''")

    sql = (
        f"INSERT INTO companies (row_num, company_name, locations, tags_json, "
        f"target_audience, job_positions, description, apply_url, apply_text, website_url, website_text) "
        f"VALUES ({c['row_num']}, '{esc(c['company_name'])}', '{esc(c['locations'])}', "
        f"'{esc(c['tags_json'])}', '{esc(c['target_audience'])}', '{esc(c['job_positions'])}', "
        f"'{esc(c['description'])}', '{esc(c['apply_url'])}', '{esc(c['apply_text'])}', "
        f"'{esc(c['website_url'])}', '{esc(c['website_text'])}');"
    )
    sql_lines.append(sql)

with open('data_migration/insert_companies.sql', 'w', encoding='utf-8') as f:
    f.write('-- Auto-generated from index.html\n')
    f.write('-- Total companies: {}\n\n'.format(len(companies)))
    f.write('\n'.join(sql_lines))

print(f"SQL file generated: data_migration/insert_companies.sql ({len(sql_lines)} statements)")

# Print first 3 and last 1 for verification
print("\n--- First 3 entries ---")
for c in companies[:3]:
    print(f"  {c['row_num']:02d}. {c['company_name']} | {c['locations']} | {c['job_positions']} | tags: {c['tags']}")

print(f"\n--- Last entry ---")
c = companies[-1]
print(f"  {c['row_num']:02d}. {c['company_name']} | {c['locations']} | {c['job_positions']}")
