#!/usr/bin/env python3
"""Generate 160+ new SOE entries from all regions of China."""
START = 1586
entries = []

def add(name, loc, url, tag="国企"):
    entries.append((name, loc, url, url.replace('https://','').replace('www.',''), tag))

# ============ 央企重要子公司 ============
add('航天一院(中国运载火箭技术研究院)', '北京', 'https://www.calt.com')
add('航天五院(中国空间技术研究院)', '北京', 'https://www.cast.cn')
add('航天八院(上海航天技术研究院)', '上海', 'https://www.sast.cn')
add('航空工业成都飞机工业集团', '成都', 'https://www.cac.avic.com')
add('航空工业沈阳飞机工业集团', '沈阳', 'https://www.sac.com.cn')
add('中国航发商用航空发动机公司', '上海', 'https://www.acae.com.cn')
add('航天科工二院', '北京', 'https://www.fy2y.com')
add('航天科工三院', '北京', 'https://www.fas.cn')
add('中电科十四所', '南京', 'https://www.cetc14.com')
add('中电科二十八所', '南京', 'https://www.cetc28.com.cn')
add('中电科三十八所', '合肥', 'https://www.cetc38.com.cn')
add('中电科五十四所', '石家庄', 'https://www.cetc54.com')
add('中电科十所', '成都', 'https://www.cetc10.com')
add('中电科二十九所', '成都', 'https://www.cetc29.com')
add('中国电子长城科技', '深圳', 'https://www.greatwall.com.cn')
add('中国电子中电熊猫', '南京', 'https://www.panda.cn')
add('中国普天信息产业集团', '北京', 'https://www.potevio.com')

add('国网江苏省电力公司', '南京', 'https://www.js.sgcc.com.cn')
add('国网浙江省电力公司', '杭州', 'https://www.zj.sgcc.com.cn')
add('国网山东省电力公司', '济南', 'https://www.sd.sgcc.com.cn')
add('南方电网广东电网公司', '广州', 'https://www.gd.csg.cn')
add('南方电网深圳供电局', '深圳', 'https://www.sz.csg.cn')
add('华能国际电力股份有限公司', '北京', 'https://www.hpi.com.cn')
add('中核集团中国核电工程公司', '北京', 'https://www.cnpe.cc')

add('中建一局', '北京', 'https://www.cscec1b.net')
add('中建三局', '武汉', 'https://www.cscec3b.com.cn')
add('中建八局', '上海', 'https://www.cscec8b.com.cn')
add('中铁一局', '西安', 'https://www.crfeb.com.cn')
add('中铁四局', '合肥', 'https://www.crec4.com')
add('中铁十一局', '武汉', 'https://www.cr11g.com.cn')
add('中交一公局', '北京', 'https://www.fheb.cn')
add('中交二航局', '武汉', 'https://www.sneb.com.cn')

add('工商银行软件开发中心', '珠海/北京/上海/广州', 'https://www.icbc.com.cn')
add('中国银行软件中心', '北京/深圳/西安/合肥', 'https://www.boc.cn')
add('农业银行研发中心', '北京/上海/广州/成都/武汉', 'https://www.abchina.com')
add('交通银行金融科技部', '上海', 'https://www.bankcomm.com')
add('中国人民保险集团研发中心', '北京', 'https://www.picc.com')
add('中国信保(出口信用保险)', '北京', 'https://www.sinosure.com.cn')

# ============ 地方国企-华北 ============
add('北京首都开发控股集团', '北京', 'https://www.bcdh.com.cn')
add('北京能源集团(京能集团)', '北京', 'https://www.powerbeijing.com')
add('北京排水集团', '北京', 'https://www.bdc.cn')
add('北京自来水集团', '北京', 'https://www.bjwatergroup.com.cn')
add('北京地铁运营公司', '北京', 'https://www.bjsubway.com')
add('天津轨道交通集团', '天津', 'https://www.tjgdjt.com')
add('天津泰达投资控股', '天津', 'https://www.teda.com.cn')
add('天津渤海化工集团', '天津', 'https://www.bcig.cn')
add('河北港口集团', '秦皇岛', 'https://www.porthebei.com')
add('山西焦煤集团', '太原', 'https://www.sxcc.com.cn')
add('山西晋能控股集团', '大同/太原', 'https://www.jnkgjt.com')

# ============ 地方国企-东北 ============
add('黑龙江省建设投资集团', '哈尔滨', 'https://www.hljcig.com')
add('吉林省高速公路集团', '长春', 'https://www.jlhighway.com')
add('吉林省能源投资集团', '长春', 'https://www.jlenergy.com.cn')
add('辽宁省交通建设投资集团', '沈阳', 'https://www.lnjtkj.com')
add('沈阳地铁集团', '沈阳', 'https://www.symtc.com')
add('大连港集团', '大连', 'https://www.dlport.cn')

# ============ 地方国企-华东 ============
add('南京地铁集团', '南京', 'https://www.njmetro.com.cn')
add('南京紫金投资集团', '南京', 'https://www.zjinv.com')
add('江苏省港口集团', '南京', 'https://www.portjs.cn')
add('南京市交通集团', '南京', 'https://www.njjtjt.com.cn')
add('浙江省国际贸易集团', '杭州', 'https://www.zjcof.com.cn')
add('浙江省旅游投资集团', '杭州', 'https://www.zjlygroup.com')
add('杭州市地铁集团', '杭州', 'https://www.hzmetro.com')
add('浙江省海港集团(宁波舟山港)', '宁波/舟山', 'https://www.zjseaport.com')
add('宁波开发投资集团', '宁波', 'https://www.nbdevelopment.com')
add('安徽省投资集团', '合肥', 'https://www.ahinv.com')
add('合肥产投集团', '合肥', 'https://www.hfctjt.com')
add('江西省投资集团', '南昌', 'https://www.jxic.com')
add('南昌市政公用集团', '南昌', 'https://www.ncszkgjt.com')
add('福建建工集团', '福州', 'https://www.fjjg.com.cn')
add('福建省投资开发集团', '福州', 'https://www.fidc.com.cn')
add('厦门轨道交通集团', '厦门', 'https://www.xmgdjt.com.cn')
add('福州地铁集团', '福州', 'https://www.fzmtr.com')

# ============ 地方国企-华中 ============
add('湖北省联合发展投资集团', '武汉', 'https://www.hblt.com.cn')
add('湖北交通投资集团', '武汉', 'https://www.hbjttz.com')
add('武汉城市建设集团', '武汉', 'https://www.whucg.com')
add('湖南省高速公路集团', '长沙', 'https://www.hngs.net')
add('湖南建设投资集团', '长沙', 'https://www.hncig.cn')
add('长沙轨道交通集团', '长沙', 'https://www.hncsmtr.com')
add('河南省投资集团', '郑州', 'https://www.hnic.com.cn')
add('河南交通投资集团', '郑州', 'https://www.hnjttz.com')
add('郑州地铁集团', '郑州', 'https://www.zzmetro.cn')

# ============ 地方国企-华南 ============
add('广东省铁路建设投资集团', '广州', 'https://www.grci.com.cn')
add('广东省港航集团', '广州', 'https://www.gdshipping.cn')
add('广州市城市建设投资集团', '广州', 'https://www.gzcity.com.cn')
add('深圳巴士集团', '深圳', 'https://www.szbus.com.cn')
add('深圳人才安居集团', '深圳', 'https://www.szrcaj.com')
add('深圳市投资控股有限公司', '深圳', 'https://www.sihc.com.cn')
add('珠海大横琴集团', '珠海', 'https://www.dhqholding.com')
add('广西建工集团', '南宁', 'https://www.gxjgjt.cn')
add('广西北部湾国际港务集团', '南宁/钦州/北海', 'https://www.bbwport.com')
add('海南农垦投资控股集团', '海口', 'https://www.hsfnc.com')

# ============ 地方国企-西南 ============
add('成都兴城投资集团', '成都', 'https://www.cdxctz.com')
add('成都轨道交通集团', '成都', 'https://www.chengdurail.com')
add('成都高新投资集团', '成都', 'https://www.cdhtgroup.com')
add('重庆城市交通开发投资集团', '重庆', 'https://www.cqjtkt.com')
add('重庆水务集团', '重庆', 'https://www.cncqsw.com')
add('重庆高速公路集团', '重庆', 'https://www.cqg56.com')
add('贵州省交通规划勘察设计院', '贵阳', 'https://www.gzjtsjy.com')
add('贵州建工集团', '贵阳', 'https://www.gzjgjt.com.cn')
add('云南省建设投资控股集团', '昆明', 'https://www.ynjstzkg.com')
add('云南省投资控股集团', '昆明', 'https://www.yig.com.cn')
add('昆明轨道交通集团', '昆明', 'https://www.kmgdgs.com')

# ============ 地方国企-西北 ============
add('陕西省交通投资集团', '西安', 'https://www.sxjtkg.com')
add('西安轨道交通集团', '西安', 'https://www.xianrail.com')
add('西安高新控股', '西安', 'https://www.xakg.com.cn')
add('甘肃省公路航空旅游投资集团', '兰州', 'https://www.ghatg.com')
add('兰州轨道交通', '兰州', 'https://www.lzgdjt.com')
add('青海省国有资产投资管理公司', '西宁', 'https://www.qhsgjt.com')
add('宁夏国有资本运营集团', '银川', 'https://www.nxgyzb.com')
add('新疆投资发展集团', '乌鲁木齐', 'https://www.xjtouzi.com')

# ============ 科研院所/事业单位 ============
add('中国科学院上海分院', '上海', 'https://www.shab.cas.cn')
add('中国科学院广州分院', '广州', 'https://www.gzb.cas.cn')
add('中国科学院成都分院', '成都', 'https://www.cdb.cas.cn')
add('中国科学院西安分院', '西安', 'https://www.xab.cas.cn')
add('中国科学院沈阳分院', '沈阳', 'https://www.syb.cas.cn')
add('中国工程物理研究院(九院)', '绵阳', 'https://www.caep.cn')
add('中国核动力研究设计院', '成都', 'https://www.npic.ac.cn')
add('中国电子科学研究院', '北京', 'https://www.caeit.cn')
add('国家无线电监测中心', '北京', 'https://www.srrc.org.cn')
add('上海科学院', '上海', 'https://www.sast.org.cn')
add('北京生命科学研究所', '北京', 'https://www.nibs.ac.cn')
add('深圳湾实验室', '深圳', 'https://www.szbl.ac.cn')
add('广州实验室', '广州', 'https://www.gzlab.ac.cn')

# ============ 文化/出版类国企 ============
add('中国出版集团', '北京', 'https://www.cnpubg.com')
add('中国电影集团', '北京', 'https://www.zgdygf.com')
add('中国教育出版传媒集团', '北京', 'https://www.cepmg.com.cn')
add('中国科技出版传媒集团', '北京', 'https://www.cspmg.com.cn')
add('上海电影集团', '上海', 'https://www.sfs-cn.com')
add('浙江出版联合集团', '杭州', 'https://www.zjcb.com')

# ============ 金融类国企 ============
add('中国证券登记结算公司', '北京/上海/深圳', 'https://www.chinaclear.cn')
add('上海期货交易所', '上海', 'https://www.shfe.com.cn')
add('郑州商品交易所', '郑州', 'https://www.czce.com.cn')
add('大连商品交易所', '大连', 'https://www.dce.com.cn')
add('中国金融期货交易所', '上海', 'https://www.cffex.com.cn')
add('中央国债登记结算公司', '北京', 'https://www.chinabond.com.cn')
add('中国东方资产管理公司', '北京', 'https://www.coamc.com.cn')
add('中国信达资产管理公司', '北京', 'https://www.cinda.com.cn')
add('中国华融资产管理公司', '北京', 'https://www.chamc.com.cn')
add('中国长城资产管理公司', '北京', 'https://www.gwamcc.com')

# ============ 烟草 ============
add('中国烟草总公司', '北京', 'https://www.tobacco.gov.cn')
add('上海烟草集团', '上海', 'https://www.sh.tobacco.com.cn')
add('云南中烟工业公司', '昆明', 'https://www.ynzy-tobacco.com')

# ============ 其他 ============
add('中国印钞造币总公司', '北京', 'https://www.cbpm.cn')
add('京沪高速铁路股份有限公司', '北京', 'https://www.cr-jh.cn')
add('中储粮集团', '北京', 'https://www.sinograin.com.cn')

print(f'Total entries: {len(entries)}')
print(f'Row range: {START} - {START + len(entries) - 1}')

# Generate SQL
lines = ['-- New SOE entries from all regions']
lines.append(f'-- {len(entries)} companies, rows {START}-{START+len(entries)-1}\n')
for i, (name, loc, url, text, tag) in enumerate(entries):
    rn = START + i
    name_esc = name.replace("'", "''")
    loc_esc = loc.replace("'", "''")
    lines.append(f"INSERT INTO companies (row_num, company_name, locations, tags_json, website_url, website_text) VALUES ({rn}, '{name_esc}', '{loc_esc}', '[\"{tag}\"]', '{url}', '{text}');")

with open('add_more_soe.sql', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print('Saved add_more_soe.sql')
