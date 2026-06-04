# 招聘信息网 — 部署说明

## 项目架构

```
用户浏览器 → Cloudflare Pages (前端静态文件)
                  ↓ AJAX fetch
           Cloudflare Workers (后端API)
                  ↓ SQL查询
           Cloudflare D1 (数据库)
```

## 部署步骤

### 前提条件

1. 安装 [Node.js](https://nodejs.org/) (LTS版本)
2. Cloudflare 账号（你已有）
3. 域名的 DNS 由 Cloudflare 管理

### 一、安装 Wrangler CLI

```bash
npm install -g wrangler
wrangler login  # 登录你的Cloudflare账号
```

### 二、创建 D1 数据库

```bash
cd /d/招聘信息/worker
wrangler d1 create recruitment-db
```

记下输出的 `database_id`，填入 `wrangler.toml` 的 `database_id` 字段。

### 三、创建 R2 存储桶（用于存储付款截图）

```bash
wrangler r2 bucket create payment-proofs
```

### 四、初始化数据库表结构

```bash
wrangler d1 execute recruitment-db --file=schema.sql
```

### 五、导入招聘数据

```bash
wrangler d1 execute recruitment-db --file=../data_migration/insert_companies.sql
```

### 六、配置环境变量

```bash
# 设置密钥（这些是敏感信息，通过 wrangler secret 设置）
wrangler secret put JWT_SECRET
# 输入一个随机字符串，例如：my-super-secret-key-2024

wrangler secret put RESEND_API_KEY
# 输入 Resend API Key（如果没有，可以先输入 placeholder）

wrangler secret put ADMIN_PASSWORD
# 设置管理员密码
```

### 七、更新 wrangler.toml

将 `wrangler.toml` 中的 `YOUR_D1_DATABASE_ID` 替换为第二步获得的实际 ID。

### 八、部署 Worker

```bash
cd /d/招聘信息/worker
npm install
wrangler deploy
```

记下输出的 Worker URL，例如 `https://recruitment-api.你的用户名.workers.dev`

### 九、配置前端 API 地址

在 Cloudflare Pages 中设置环境变量：
- 进入 Cloudflare Dashboard → Pages → 你的项目
- Settings → Environment variables
- 添加：`API_BASE_URL` = 你的 Worker URL（例如 `https://recruitment-api.xxx.workers.dev`）

### 十、部署前端到 Cloudflare Pages

```bash
cd /d/招聘信息/frontend
wrangler pages deploy . --project-name=你的项目名
```

或者通过 Cloudflare Dashboard 上传 `frontend/` 目录。

### 十一、准备收款码图片

1. 打开支付宝 → 我的 → 收款 → 保存收款码
2. 打开微信 → 我 → 收付款 → 二维码收款 → 保存收款码
3. 将两张图片替换到 `frontend/images/` 目录：
   - `alipay_qr.png` — 支付宝收款码
   - `wechat_qr.png` — 微信收款码
4. 重新部署前端

### 十二、配置 Resend 邮件服务（可选）

1. 注册 [resend.com](https://resend.com)
2. 添加你的发送域名（或使用 resend.dev 测试域名）
3. 获取 API Key
4. 设置到 Worker secrets：`wrangler secret put RESEND_API_KEY`

如果不配置 Resend，验证邮件将不会发送，但验证链接会打印在 Worker 日志中（开发阶段可用）。

## 本地测试

```bash
cd /d/招聘信息/worker
npm install
npx wrangler dev --local
```

然后用浏览器打开前端文件（通过简单的 HTTP 服务器）：

```bash
cd /d/招聘信息/frontend
npx serve .
```

## 费用

| 服务 | 免费额度 | 预计花费 |
|---|---|---|
| Cloudflare Pages | 无限 | ¥0 |
| Cloudflare Workers | 10万次/天 | ¥0 |
| Cloudflare D1 | 5GB / 5亿次读/月 | ¥0 |
| Cloudflare R2 | 10GB | ¥0 |
| Resend | 100封/天 | ¥0 |
| **总月费** | | **¥0** |

## 管理后台

访问 `https://你的域名/admin.html`，输入管理员密码即可：
- 查看统计数据（注册用户数、收入等）
- 审核待确认的付款截图
- 点击"确认收款"后系统自动开通/延长订阅
- 系统自动发送确认邮件给用户

## 需要你自己处理的事项

- [ ] 准备支付宝/微信收款码图片
- [ ] 在 Cloudflare Dashboard 创建 D1 数据库
- [ ] 在 Cloudflare Dashboard 创建 R2 存储桶
- [ ] 配置 Resend 邮件服务（可选）
- [ ] 更改默认管理员密码（wrangler.toml 或 secrets）
- [ ] 更改 JWT_SECRET
