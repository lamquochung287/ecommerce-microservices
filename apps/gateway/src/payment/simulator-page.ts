// HTML tĩnh cho trang giả lập thanh toán. Không có script inline (tương thích CSP của helmet);
// mọi giá trị chèn vào HTML đều đi qua escapeHtml.

export interface SimulatorIntent {
	intentId: string;
	orderId: string;
	amount: number;
	status: string;
	expiresAt: string | null;
	expired: boolean;
}

export function escapeHtml(value: unknown): string {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const layout = (title: string, body: string) => `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px}
.warn{background:#fff3cd;border:1px solid #ffe69c;padding:8px 12px;border-radius:4px}
button{padding:10px 16px;margin-right:8px;cursor:pointer}dt{font-weight:bold;margin-top:8px}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;

export function renderSimulatorPage(intent: SimulatorIntent): string {
	const warnings: string[] = [];
	if (intent.expired) {
		warnings.push(
			'Đã quá hạn giữ hàng. Thanh toán lúc này có thể dẫn tới hoàn tiền tự động.',
		);
	}
	if (intent.status === 'CANCELLED') {
		warnings.push('Giao dịch đã bị huỷ.');
	}
	const warningHtml = warnings
		.map((message) => `<p class="warn">${escapeHtml(message)}</p>`)
		.join('\n');
	const action = `/simulator/pay/${encodeURIComponent(intent.intentId)}`;
	return layout(
		'Giả lập thanh toán',
		`${warningHtml}
<dl>
<dt>Mã giao dịch</dt><dd>${escapeHtml(intent.intentId)}</dd>
<dt>Mã đơn</dt><dd>${escapeHtml(intent.orderId)}</dd>
<dt>Số tiền</dt><dd>${escapeHtml(intent.amount)}</dd>
<dt>Trạng thái</dt><dd>${escapeHtml(intent.status)}</dd>
<dt>Hạn thanh toán</dt><dd>${escapeHtml(intent.expiresAt ?? 'Không giới hạn')}</dd>
</dl>
<form method="post" action="${escapeHtml(action)}/success" style="display:inline">
<button type="submit">Thanh toán thành công</button>
</form>
<form method="post" action="${escapeHtml(action)}/fail" style="display:inline">
<button type="submit">Thanh toán thất bại</button>
</form>`,
	);
}

export function renderSimulatorResultPage(
	result: 'success' | 'fail',
	alreadyProcessed: boolean,
): string {
	const outcome =
		result === 'success' ? 'Thanh toán thành công' : 'Thanh toán thất bại';
	const note = alreadyProcessed
		? 'Giao dịch này đã được ghi nhận trước đó (webhook trùng, không xử lý lại).'
		: 'Đã gửi kết quả về hệ thống.';
	return layout(outcome, `<p>${escapeHtml(note)}</p>`);
}

export function renderSimulatorErrorPage(message: string): string {
	return layout(
		'Không thực hiện được',
		`<p class="warn">${escapeHtml(message)}</p>`,
	);
}
