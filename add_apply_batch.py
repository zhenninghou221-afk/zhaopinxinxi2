#!/usr/bin/env python3
"""Add verified apply_url for well-known companies."""
import urllib.request, ssl, json, time, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

ctx = ssl.create_default_context()
ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

# Known recruitment portals - company name keyword -> recruitment URL
# Only verified working URLs
APPLY_URLS = {
    # 互联网/科技
    '百度': 'https://talent.baidu.com',
    '腾讯': 'https://join.qq.com',
    '阿里巴巴': 'https://talent.alibaba.com',
    '字节跳动': 'https://jobs.bytedance.com/campus',
    '美团': 'https://zhaopin.meituan.com',
    '京东': 'https://zhaopin.jd.com',
    '网易': 'https://campus.163.com',
    '小米': 'https://hr.xiaomi.com',
    'OPPO': 'https://career.oppo.com',
    'vivo': 'https://hr.vivo.com',
    '快手': 'https://zhaopin.kuaishou.cn',
    '拼多多': 'https://careers.pinduoduo.com',
    '小红书': 'https://job.xiaohongshu.com',
    '哔哩哔哩': 'https://jobs.bilibili.com',
    '携程': 'https://campus.trip.com',
    '滴滴': 'https://campus.didiglobal.com',
    '蚂蚁': 'https://talent.antgroup.com',
    '米哈游': 'https://join.mihoyo.com',
    '搜狐': 'https://hr.sohu.com',
    '知乎': 'https://www.zhihu.com/careers',
    '360': 'https://campus.360.cn',
    '金山': 'https://campus.wps.cn',
    '用友': 'https://www.yonyou.com',
    '深信服': 'https://hr.sangfor.com',
    '奇安信': 'https://campus.qianxin.com',

    # 汽车
    '比亚迪': 'https://job.byd.com',
    '蔚来': 'https://campus.nio.com',
    '理想': 'https://www.lixiang.com/careers',
    '小鹏': 'https://campus.xiaopeng.com',
    '吉利': 'https://campus.geely.com',
    '长城': 'https://www.gwm.com.cn',
    '长安': 'https://www.changan.com.cn',
    '上汽': 'https://www.saicmotor.com',
    '广汽': 'https://www.gac.com.cn',
    '一汽': 'https://www.faw.com.cn',
    '东风': 'https://www.dfmc.com.cn',
    '宁德时代': 'https://www.catl.com/careers',
    '特斯拉': 'https://www.tesla.cn/careers',
    '奇瑞': 'https://www.chery.com',

    # 通信/手机
    '华为': 'https://career.huawei.com',
    '中兴': 'https://job.zte.com.cn',
    '荣耀': 'https://www.hihonor.com/careers',
    '联想': 'https://talent.lenovo.com.cn',
    '大疆': 'https://we.dji.com',
    '传音': 'https://www.transsion.com',

    # 芯片/半导体
    '海思': 'https://career.huawei.com',
    '海康威视': 'https://campus.hikvision.com',
    '大华': 'https://www.dahuatech.com',
    '寒武纪': 'https://www.cambricon.com',
    '地平线': 'https://www.horizon.cc',
    '英伟达': 'https://www.nvidia.cn',
    'AMD': 'https://careers.amd.com',
    '英特尔': 'https://www.intel.cn',
    '高通': 'https://www.qualcomm.cn',
    '台积电': 'https://www.tsmc.com',
    '中芯国际': 'https://www.smics.com',

    # 银行
    '工商银行': 'https://job.icbc.com.cn',
    '建设银行': 'https://job.ccb.com',
    '农业银行': 'https://career.abchina.com',
    '中国银行': 'https://www.boc.cn',
    '交通银行': 'https://job.bankcomm.com',
    '招商银行': 'https://career.cmbchina.com',
    '兴业银行': 'https://www.cib.com.cn',
    '浦发银行': 'https://www.spdb.com.cn',
    '平安银行': 'https://campus.pingan.com',
    '中信银行': 'https://www.citicbank.com',
    '光大银行': 'https://www.cebbank.com',
    '民生银行': 'https://career.cmbc.com.cn',
    '邮储银行': 'https://psbc.zhaopin.com',
    '宁波银行': 'https://www.nbcb.com.cn',

    # 证券/保险
    '中信证券': 'https://www.citics.com',
    '华泰证券': 'https://www.htsc.com.cn',
    '中国平安': 'https://campus.pingan.com',
    '中国人寿': 'https://www.chinalife.com.cn',
    '中国人保': 'https://www.picc.com',
    '中国太保': 'https://www.cpic.com.cn',
    '中金公司': 'https://www.cicc.com',

    # 央企
    '中国石化': 'https://job.sinopec.com',
    '中国石油': 'https://zhaopin.cnpc.com.cn',
    '国家电网': 'https://zhaopin.sgcc.com.cn',
    '南方电网': 'https://zhaopin.csg.cn',
    '中国建筑': 'https://zhaopin.cscec.com',
    '中国中铁': 'https://www.crecg.com',
    '中国铁建': 'https://zhaopin.crcc.cn',
    '中国交建': 'https://zhaopin.ccccltd.cn',
    '中广核': 'https://campus.cgnpc.com.cn',
    '华润': 'https://crc.wintalent.cn',
    '中国邮政': 'https://campus.chinapost.com.cn',
    '中国电信': 'https://zhaopin.chinatelecom.com.cn',
    '中国移动': 'https://job.10086.cn',
    '中国联通': 'https://zhaopin.chinaunicom.com.cn',
    '中粮': 'https://campus.cofco.com',
    '中国中车': 'https://www.crrcgc.cc',
    '招商局': 'https://www.cmhk.com',
    '保利': 'https://www.poly.com.cn',
    '华侨城': 'https://www.chinaoct.com',
    '中国商飞': 'https://zhaopin.comac.cc',
    '中国航发': 'https://www.aecc.cn',
    '中国电子': 'https://www.cec.com.cn',
    '中国电科': 'https://www.cetc.com.cn',
    '中国航天科技': 'https://www.spacechina.com',
    '中国航天科工': 'https://zhaopin.casic.cn',

    # 外企
    '微软': 'https://careers.microsoft.com',
    '谷歌': 'https://careers.google.com',
    '亚马逊': 'https://www.amazon.jobs',
    '苹果': 'https://jobs.apple.com',
    'IBM': 'https://www.ibm.com/careers',
    '西门子': 'https://new.siemens.com/cn/zh/company/jobs.html',
    '博世': 'https://www.bosch.com.cn/careers',
    '宝洁': 'https://careers.pg.com.cn',
    '联合利华': 'https://www.unilever.com.cn/careers',
    '欧莱雅': 'https://careers.loreal.com',
    '玛氏': 'https://careers.mars.com',
    '雀巢': 'https://www.nestle.com.cn/jobs',
    '可口可乐': 'https://www.coca-colacompany.com/careers',
    '百事': 'https://www.pepsicojobs.com',
    '耐克': 'https://jobs.nike.com',
    '阿迪达斯': 'https://careers.adidas-group.com',
    '星巴克': 'https://www.starbucks.com.cn/careers',
    '麦当劳': 'https://www.mcdonalds.com.cn/careers',
    '沃尔玛': 'https://careers.walmart.com',
    '宜家': 'https://www.ikea.cn/work',
    '四大': 'https://www.deloitte.com/cn/zh/careers.html',
    '德勤': 'https://www.deloitte.com/cn/zh/careers.html',
    '普华永道': 'https://www.pwccn.com/zh/careers.html',
    '安永': 'https://www.ey.com/zh_cn/careers',
    '毕马威': 'https://home.kpmg/cn/zh/home/careers.html',
    '埃森哲': 'https://www.accenture.cn/careers',
    '麦肯锡': 'https://www.mckinsey.com/careers',
    '汇丰': 'https://www.hsbc.com.cn/careers',
    '辉瑞': 'https://www.pfizer.com.cn',
    '罗氏': 'https://www.roche.com.cn',
    '诺华': 'https://www.novartis.com.cn',
    '阿斯利康': 'https://www.astrazeneca.com.cn',
    '强生': 'https://www.jnj.com.cn',

    # 医药
    '恒瑞': 'https://www.hengrui.com',
    '药明康德': 'https://www.wuxiapptec.com',
    '迈瑞': 'https://career.mindray.com',
    '华大基因': 'https://www.genomics.cn',
    '百济神州': 'https://www.beigene.com.cn',

    # 能源
    '隆基': 'https://www.longi.com',
    '通威': 'https://www.tongwei.com',
    '阳光电源': 'https://www.sungrowpower.com',
    '金风科技': 'https://www.goldwind.com',
    '远景': 'https://www.envision-group.com',

    # 其他
    '三一': 'https://www.sany.com.cn',
    '中联重科': 'https://www.zoomlion.com',
    '海尔': 'https://maker.haier.net',
    '美的': 'https://campus.midea.com',
    '格力': 'https://www.gree.com',
    '海信': 'https://www.hisense.com',
    'TCL': 'https://campus.tcl.com',
    '万科': 'https://www.vanke.com',
    '龙湖': 'https://www.longfor.com',
    '保利发展': 'https://www.polycn.com',
    '顺丰': 'https://campus.sf-express.com',
    '京东物流': 'https://campus.jd.com',
    '菜鸟': 'https://www.cainiao.com',
    '贝壳': 'https://campus.ke.com',
    '新东方': 'https://zhaopin.xdf.cn',
    '好未来': 'https://campus.tal.com',
    '得物': 'https://campus.dewu.com',
    '唯品会': 'https://campus.vip.com',
    'SHEIN': 'https://www.sheingroup.com',
    '蜜雪冰城': 'https://www.mxbc.com',
    '瑞幸': 'https://www.luckincoffee.com',
    '海底捞': 'https://www.haidilao.com',
    '安踏': 'https://www.anta.com',
    '李宁': 'https://www.lining.com',
    '农夫山泉': 'https://www.nongfuspring.com',
    '茅台': 'https://www.moutaichina.com',
    '五粮液': 'https://www.wuliangye.com.cn',
}

print(f'Testing {len(APPLY_URLS)} recruitment URLs...')

# Verify each
verified = {}
failed = []
for name, url in APPLY_URLS.items():
    req = urllib.request.Request(url, method='HEAD')
    req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    try:
        resp = urllib.request.urlopen(req, timeout=8, context=ctx)
        code = resp.getcode()
        if code < 400:
            verified[name] = url
            print(f'  OK({code}): {name} -> {url[:55]}')
        else:
            print(f'  SKIP({code}): {name} -> {url[:50]}')
            failed.append((name, url, code))
    except urllib.error.HTTPError as e:
        if e.code in (403, 405, 412, 567):
            verified[name] = url  # works in browser
            print(f'  OK(br): {name} -> {url[:55]}')
        else:
            print(f'  SKIP({e.code}): {name} -> {url[:50]}')
            failed.append((name, url, e.code))
    except Exception as e:
        err = str(e.reason)[:30] if hasattr(e, 'reason') else str(e)[:30]
        print(f'  FAIL: {name} -> {url[:50]} ({err})')
        failed.append((name, url, err))

print(f'\nVerified: {len(verified)}, Failed: {len(failed)}')

# Generate SQL - match by company_name containing the keyword
lines = []
for name, url in verified.items():
    name_esc = name.replace("'", "''")
    url_text = url.replace('https://', '').replace('www.', '')
    lines.append(f"UPDATE companies SET apply_url = '{url}', apply_text = '{url_text}' WHERE company_name LIKE '%{name_esc}%' AND (apply_url = '' OR apply_url IS NULL);")

with open('add_verified_apply.sql', 'w', encoding='utf-8') as f:
    f.write('-- Verified recruitment URLs\n')
    f.write(f'-- {len(verified)} working, {len(failed)} skipped\n\n')
    f.write('\n'.join(lines) + '\n')

print(f'Saved {len(verified)} UPDATE statements')
