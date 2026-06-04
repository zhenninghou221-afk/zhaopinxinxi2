#!/usr/bin/env python3
with open('登陆注册/payment.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the QR section
start_marker = '<div class="qr-section">'
end_marker = '</div>\n\n	    <div class="alert tips"'

start = content.find(start_marker)
end = content.find(end_marker)

if start >= 0 and end >= 0:
    end = content.find('</div>', end - 200) + 6  # find the closing div of qr-section
    if end < start:
        # Try different approach
        end = content.find('</div>\n\n	    <div class="alert tips"')

    # Actually let me find the exact end of qr-section
    tmp = content[start:]
    # Find the third </div> (qr-section > qr-card > qr-card > /qr-section)
    div_count = 0
    pos = 0
    while div_count < 4:
        pos = tmp.find('</div>', pos + 1)
        if pos < 0: break
        div_count += 1
    if pos >= 0:
        end = start + pos + 6

    replacement = '''<div class="pay-btns">
	      <button class="pay-btn alipay-btn" onclick="showQR('alipay')">支付宝 付款</button>
	      <button class="pay-btn wechat-btn" onclick="showQR('wechat')">微信支付</button>
	    </div>

	    <div class="modal-overlay" id="qrModal" onclick="if(event.target===this)hideQR()">
	      <div class="modal-box">
	        <img id="qrImage" src="" alt="收款码">
	        <p style="margin-top:8px;font-size:.85em;color:#666;" id="qrLabel"></p>
	        <button class="modal-close" onclick="hideQR()">关闭</button>
	      </div>
	    </div>'''

    old_section = content[start:end]
    content = content.replace(old_section, replacement)

    # Add JS functions for modal
    js = '''
function showQR(type) {
  var modal = document.getElementById('qrModal');
  var img = document.getElementById('qrImage');
  var label = document.getElementById('qrLabel');
  if (type === 'alipay') {
    img.src = '/登陆注册/images/alipay_qr.png';
    label.textContent = '支付宝扫码支付 ¥9.90';
  } else {
    img.src = '/登陆注册/images/wechat_qr.png';
    label.textContent = '微信扫码支付 ¥9.90';
  }
  modal.classList.add('show');
}
function hideQR() {
  document.getElementById('qrModal').classList.remove('show');
}
'''
    content = content.replace('initPaymentPage();', js + '\ninitPaymentPage();')

    with open('登陆注册/payment.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Payment page updated!')
else:
    print(f'Markers not found: start={start}, end={end}')
