#!/usr/bin/env python3
"""Add popular/accessible SOEs at the front of the new batch."""
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

POPULAR = [
    ('中国邮政集团有限公司', '全国各城市', 'https://www.chinapost.com.cn', 'chinapost.com.cn', '央企'),
    ('中国石化销售有限公司', '全国各城市', 'https://www.sinopec.com', 'sinopec.com', '央企'),
    ('中国石油天然气股份有限公司', '全国各城市', 'https://www.cnpc.com.cn', 'cnpc.com.cn', '央企'),
    ('中国电信集团有限公司', '全国各省市', 'https://www.chinatelecom.com.cn', 'chinatelecom.com.cn', '央企'),
    ('中国移动通信集团有限公司', '全国各省市', 'https://www.10086.cn', '10086.cn', '央企'),
    ('中国联合网络通信集团', '全国各省市', 'https://www.chinaunicom.com.cn', 'chinaunicom.com.cn', '央企'),
    ('中粮集团有限公司', '北京/全国', 'https://www.cofco.com', 'cofco.com', '央企'),
    ('华润万家有限公司', '全国各城市', 'https://www.crv.com.cn', 'crv.com.cn', '央企'),
    ('华润雪花啤酒', '北京/成都/武汉/沈阳', 'https://www.snowbeer.com.cn', 'snowbeer.com.cn', '央企'),
    ('中国黄金集团有限公司', '北京/全国', 'https://www.chinagoldgroup.com', 'chinagoldgroup.com', '央企'),
    ('华侨城集团有限公司', '深圳/全国', 'https://www.chinaoct.com', 'chinaoct.com', '央企'),
    ('保利发展控股集团', '广州/全国', 'https://www.polycn.com', 'polycn.com', '央企'),
    ('中国旅游集团有限公司', '香港/深圳/北京/上海', 'https://www.ctg.cn', 'ctg.cn', '央企'),
    ('中国中免(中免集团)', '三亚/海口/北京/上海', 'https://www.ctgdutyfree.com.cn', 'ctgdutyfree.com.cn', '央企'),
    ('华润置地有限公司', '全国各城市', 'https://www.crland.com.hk', 'crland.com.hk', '央企'),
    ('中国铁路工程集团(中铁)', '北京/全国', 'https://www.crecg.com', 'crecg.com', '央企'),
    ('中国铁建股份有限公司', '北京/全国', 'https://www.crcc.cn', 'crcc.cn', '央企'),
    ('中国交通建设集团(中交)', '北京/全国', 'https://www.ccccltd.cn', 'ccccltd.cn', '央企'),
    ('中国能源建设集团', '北京/全国', 'https://www.ceec.net.cn', 'ceec.net.cn', '央企'),
    ('中国核工业建设集团', '北京/全国', 'https://www.cnecc.com', 'cnecc.com', '央企'),
    ('中国有色矿业集团有限公司', '北京', 'https://www.cnmc.com.cn', 'cnmc.com.cn', '央企'),
    ('中国铝业集团有限公司', '北京', 'https://www.chalco.com.cn', 'chalco.com.cn', '央企'),
    ('中国中车股份有限公司', '北京/株洲/青岛/长春/唐山', 'https://www.crrcgc.cc', 'crrcgc.cc', '央企'),
    ('新兴际华集团有限公司', '北京/邯郸', 'https://www.xxcig.com', 'xxcig.com', '央企'),
    ('中国盐业集团有限公司', '北京/全国', 'https://www.chinasalt.com.cn', 'chinasalt.com.cn', '央企'),
    ('中国煤炭科工集团有限公司', '北京', 'https://www.ccteg.cn', 'ccteg.cn', '央企'),
    ('中国钢研科技集团有限公司', '北京', 'https://www.cisri.com', 'cisri.com', '央企'),
    ('中国民航信息集团有限公司', '北京', 'https://www.travelsky.com.cn', 'travelsky.com.cn', '央企'),
    ('中国航空油料集团有限公司', '北京/全国各地机场', 'https://www.cnaf.com', 'cnaf.com', '央企'),
    ('中国铁道科学研究院集团', '北京', 'https://www.rails.cn', 'rails.cn', '央企'),
]

START = 1731
popular_lines = []
for i, (name, loc, url, text, tag) in enumerate(POPULAR):
    rn = START + i
    name_esc = name.replace("'", "''")
    loc_esc = loc.replace("'", "''")
    popular_lines.append(f"INSERT INTO companies (row_num, company_name, locations, tags_json, website_url, website_text) VALUES ({rn}, '{name_esc}', '{loc_esc}', '[\"{tag}\"]', '{url}', '{text}');")

# Read existing batch
with open('add_more_soe.sql', 'r', encoding='utf-8') as f:
    existing = f.read()

with open('add_all_soe.sql', 'w', encoding='utf-8') as f:
    f.write('-- Popular/accessible SOEs (lower barrier, well-known brands)\n')
    f.write(f'-- {len(POPULAR)} companies\n\n')
    f.write('\n'.join(popular_lines) + '\n\n')
    f.write(existing)

print(f'Popular: {len(POPULAR)}, Total: {len(POPULAR) + 145}')
print(f'Row range: 1586 - {START + len(POPULAR) - 1}')
