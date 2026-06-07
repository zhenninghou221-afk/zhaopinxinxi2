-- Separate website_url (官网) and apply_url (投递入口)
-- 14 companies with both valid URLs

UPDATE companies SET website_url = 'https://www.xiaohongshu.com', website_text = 'xiaohongshu.com', apply_url = 'https://job.xiaohongshu.com', apply_text = 'job.xiaohongshu.com' WHERE row_num = 11;
UPDATE companies SET website_url = 'https://www.bilibili.com', website_text = 'bilibili.com', apply_url = 'https://jobs.bilibili.com', apply_text = 'jobs.bilibili.com' WHERE row_num = 14;
UPDATE companies SET website_url = 'https://www.vip.com', website_text = 'vip.com', apply_url = 'https://campus.vip.com', apply_text = 'campus.vip.com' WHERE row_num = 16;
UPDATE companies SET website_url = 'https://www.ke.com', website_text = 'ke.com', apply_url = 'https://campus.ke.com', apply_text = 'campus.ke.com' WHERE row_num = 17;
UPDATE companies SET website_url = 'https://www.sohu.com', website_text = 'sohu.com', apply_url = 'https://hr.sohu.com', apply_text = 'hr.sohu.com' WHERE row_num = 18;
UPDATE companies SET website_url = 'https://www.zhihu.com', website_text = 'zhihu.com', apply_url = 'https://www.zhihu.com/careers', apply_text = 'zhihu.com/careers' WHERE row_num = 19;
UPDATE companies SET website_url = 'https://www.sensetime.com', website_text = 'sensetime.com', apply_url = 'https://www.sensetime.com/careers', apply_text = 'sensetime.com/careers' WHERE row_num = 25;
UPDATE companies SET website_url = 'https://www.oppo.com', website_text = 'oppo.com', apply_url = 'https://career.oppo.com', apply_text = 'career.oppo.com' WHERE row_num = 33;
UPDATE companies SET website_url = 'https://www.hihonor.com', website_text = 'hihonor.com', apply_url = 'https://www.hihonor.com/careers', apply_text = 'hihonor.com/careers' WHERE row_num = 34;
UPDATE companies SET website_url = 'https://www.dahuatech.com', website_text = 'dahuatech.com', apply_url = 'https://www.dahuatech.com', apply_text = 'dahuatech.com' WHERE row_num = 37;
UPDATE companies SET website_url = 'https://www.tesla.com', website_text = 'tesla.com', apply_url = 'https://www.tesla.cn/careers', apply_text = 'tesla.cn/careers' WHERE row_num = 44;
UPDATE companies SET website_url = 'https://www.geely.com', website_text = 'geely.com', apply_url = 'https://campus.geely.com', apply_text = 'campus.geely.com' WHERE row_num = 45;
UPDATE companies SET website_url = 'https://www.gwm.com.cn', website_text = 'gwm.com.cn', apply_url = 'https://www.gwm.com.cn/careers', apply_text = 'gwm.com.cn/careers' WHERE row_num = 46;
UPDATE companies SET website_url = 'https://www.mihoyo.com', website_text = 'mihoyo.com', apply_url = 'https://join.mihoyo.com', apply_text = 'join.mihoyo.com' WHERE row_num = 47;
