// Load test cho gateway: ramp-up tới TARGET_VUS user đồng thời để tìm điểm bão hòa của VPS.
//
// Chạy (xem docs/load-testing-guide.md):
//   k6 run -e API_KEY=loadtest-api-key loadtest/k6/load-test.js
//
// Biến môi trường (-e KEY=value):
//   API_KEY     bắt buộc, trùng API_KEY của gateway
//   BASE_URL    mặc định http://localhost:3000
//   PROFILE     mixed (80% đọc / 15% cart / 5% checkout) | read | cart | checkout | auth
//   TARGET_VUS  mặc định 500
//   RAMP        thời gian tăng tải, mặc định 5m
//   HOLD        thời gian giữ tải đỉnh, mặc định 5m
//   WAVE_SIZE   >0 bật chế độ đợt: mỗi đợt WAVE_SIZE user đăng nhập cùng lúc (thay cho RAMP), mặc định 0 (tắt)
//   WAVE_INTERVAL_S  giây giữa hai đợt, mặc định 30
//   PAY_RATIO     tỉ lệ đơn checkout được thanh toán qua simulator, mặc định 0.7 (phần còn lại bỏ dở, tự hết hạn)
//   CANCEL_RATIO  tỉ lệ đơn (sau bước thanh toán) bị user huỷ, mặc định 0.1
//
// Luồng checkout đầy đủ: checkout -> GET /orders/:id/pay (chốt còn hàng) -> POST /simulator/pay/:intentId/success
// -> (tuỳ chọn) POST /orders/:id/cancel. Cần Payment ở PAYMENT_SIM_MODE=manual và NODE_ENV != production
// (compose loadtest đã đặt sẵn); nếu simulator bị tắt thì bước thanh toán trả 404 và được ghi vào lt_pay_unavailable.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY;
const PROFILE = __ENV.PROFILE || 'mixed';
const TARGET_VUS = Number(__ENV.TARGET_VUS || 500);
const RAMP = __ENV.RAMP || '5m';
const HOLD = __ENV.HOLD || '5m';
const WAVE_SIZE = Number(__ENV.WAVE_SIZE || 0);
const WAVE_INTERVAL_S = Number(__ENV.WAVE_INTERVAL_S || 30);
const PAY_RATIO = Number(__ENV.PAY_RATIO ?? 0.7);
const CANCEL_RATIO = Number(__ENV.CANCEL_RATIO ?? 0.1);

// Access token sống 15 phút và gateway chưa có endpoint refresh, nên login lại trước hạn.
const TOKEN_MAX_AGE_MS = 14 * 60 * 1000;

// 400/409/422 = checkout bị từ chối theo nghiệp vụ (vd hết hàng, món không có trong giỏ), không tính là lỗi server.
const CHECKOUT_REJECTED = [400, 409, 422];

// Tỉ lệ [browse, cart, checkout] theo profile; auth chỉ login lặp lại.
const PROFILES = {
	mixed: [80, 15, 5],
	read: [100, 0, 0],
	cart: [0, 100, 0],
	checkout: [0, 0, 100],
	auth: [0, 0, 0],
};
if (!API_KEY) throw new Error('Thiếu API_KEY: k6 run -e API_KEY=... loadtest/k6/load-test.js');
if (!PROFILES[PROFILE]) throw new Error(`PROFILE không hợp lệ: ${PROFILE}`);

// scripts/seeded-users.csv do `npm run seed` sinh ra (mật khẩu Password123).
const users = new SharedArray('users', () =>
	open('../../scripts/seeded-users.csv')
		.split('\n')
		.slice(1)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [email, password] = line.split(',');
			return { email, password };
		}),
);

const loginDuration = new Trend('lt_login_duration', true);
const browseDuration = new Trend('lt_browse_duration', true);
const cartDuration = new Trend('lt_cart_duration', true);
const checkoutDuration = new Trend('lt_checkout_duration', true);
const serverErrors = new Rate('lt_server_errors'); // 5xx, timeout, 429
const checkoutRejected = new Counter('lt_checkout_rejected'); // hết hàng... (lỗi nghiệp vụ, không tính là lỗi server)
const checkoutOk = new Counter('lt_checkout_ok');
const payLinkDuration = new Trend('lt_pay_link_duration', true);
const payDuration = new Trend('lt_pay_duration', true);
const cancelDuration = new Trend('lt_cancel_duration', true);
const orderPaid = new Counter('lt_order_paid'); // simulator ghi nhận thanh toán thành công
const orderCancelled = new Counter('lt_order_cancelled');
const payUnavailable = new Counter('lt_pay_unavailable'); // simulator bị tắt (404): kiểm NODE_ENV / PAYMENT_SIM_MODE

// Chế độ đợt (WAVE_SIZE > 0): cứ mỗi WAVE_INTERVAL_S giây thêm WAVE_SIZE user trong 1 giây (các user này login cùng lúc),
// lặp tới TARGET_VUS rồi giữ HOLD. Thay cho RAMP tuyến tính để mô phỏng nhiều user cùng đăng nhập một lúc.
function buildStages() {
	if (WAVE_SIZE <= 0) return [{ duration: RAMP, target: TARGET_VUS }, { duration: HOLD, target: TARGET_VUS }];
	const stages = [];
	for (let target = WAVE_SIZE; target <= TARGET_VUS; target += WAVE_SIZE) {
		stages.push({ duration: '1s', target });
		stages.push({ duration: `${Math.max(1, WAVE_INTERVAL_S - 1)}s`, target });
	}
	stages.push({ duration: HOLD, target: TARGET_VUS });
	return stages;
}

export const options = {
	scenarios: {
		users: {
			executor: 'ramping-vus',
			startVUs: 0,
			stages: [...buildStages(), { duration: '30s', target: 0 }],
			gracefulRampDown: '30s',
		},
	},
	// Ngưỡng SLO: dùng để kết luận cấu hình VPS có đạt hay không.
	thresholds: {
		lt_server_errors: ['rate<0.01'],
		lt_login_duration: ['p(95)<1500'],
		lt_browse_duration: ['p(95)<500'],
		lt_cart_duration: ['p(95)<800'],
		lt_checkout_duration: ['p(95)<2000'],
		lt_pay_link_duration: ['p(95)<1000'],
		lt_pay_duration: ['p(95)<2000'],
		lt_cancel_duration: ['p(95)<2000'],
	},
	summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function headers(token, extra) {
	const h = { 'Content-Type': 'application/json', 'x-api-key': API_KEY, ...extra };
	if (token) h.Authorization = `Bearer ${token}`;
	return h;
}

// Gateway bắt buộc x-idempotency-key cho checkout; mỗi lần gọi một key mới dạng UUID v4.
function uuidv4() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

// 0 = lỗi mạng/timeout phía k6, 408 = gateway quá hạn chờ service, 429 = bị throttle, 5xx = lỗi server.
const isServerError = (status) => status === 0 || status === 408 || status === 429 || status >= 500;

function track(res, trend) {
	trend.add(res.timings.duration);
	serverErrors.add(isServerError(res.status));
	return res;
}

function login(user) {
	const res = track(
		http.post(`${BASE_URL}/user/login`, JSON.stringify(user), {
			headers: headers(),
			tags: { name: 'POST /user/login' },
		}),
		loginDuration,
	);
	const ok = check(res, { 'login 2xx': (r) => r.status >= 200 && r.status < 300 });
	return ok ? res.json('data.accessToken') : null;
}

// Lấy sẵn danh sách productId để các VU dùng chung (cart/checkout cần UUID thật).
export function setup() {
	const token = login(users[0]);
	if (!token) throw new Error('Không login được user seed; đã chạy `npm run seed` chưa?');
	const ids = [];
	for (let page = 1; page <= 5; page++) {
		const res = http.get(`${BASE_URL}/products?page=${page}&limit=100`, {
			headers: headers(token),
		});
		const list = res.json('data') || [];
		for (const p of list) ids.push(p.id);
	}
	if (!ids.length) throw new Error('Không lấy được product; kiểm tra seed và quyền PRODUCT:READ');
	return { productIds: ids };
}

// Trạng thái riêng của từng VU (mỗi VU = 1 user cố định).
let token = null;
let tokenAt = 0;

function ensureToken(user) {
	if (!token || Date.now() - tokenAt > TOKEN_MAX_AGE_MS) {
		token = login(user);
		tokenAt = Date.now();
	}
	return token;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function browse(ids, jwt) {
	const page = 1 + Math.floor(Math.random() * 500);
	track(
		http.get(`${BASE_URL}/products?page=${page}&limit=20`, {
			headers: headers(jwt),
			tags: { name: 'GET /products' },
		}),
		browseDuration,
	);
	sleep(1 + Math.random() * 2);
	track(
		http.get(`${BASE_URL}/products/${pick(ids)}`, {
			headers: headers(jwt),
			tags: { name: 'GET /products/:id' },
		}),
		browseDuration,
	);
}

function addToCart(ids, jwt) {
	track(
		http.post(
			`${BASE_URL}/cart/items`,
			JSON.stringify({ productId: pick(ids), quantity: 1 }),
			{ headers: headers(jwt), tags: { name: 'POST /cart/items' } },
		),
		cartDuration,
	);
}

function cart(ids, jwt) {
	addToCart(ids, jwt);
	sleep(0.5 + Math.random());
	track(
		http.get(`${BASE_URL}/cart`, { headers: headers(jwt), tags: { name: 'GET /cart' } }),
		cartDuration,
	);
}

// Checkout v2: chỉ gửi định danh món được chọn (số lượng lấy từ giỏ, giá lấy từ Product) và địa chỉ.
// Kết quả mong đợi là 201 PENDING_PAYMENT kèm payment_url. Sau đó một phần đơn (PAY_RATIO) được thanh toán qua
// simulator để chạy tiếp pha bất đồng bộ qua Kafka (PAID -> FULFILLING -> SHIPPED); phần còn lại bỏ dở và tự hết
// hạn sau ORDER_PAYMENT_TTL_SECONDS, hàng được trả lại. Cùng sản phẩm thì lần checkout sau thay thế đơn cũ.
function checkout(ids, jwt) {
	const productId = pick(ids);
	track(
		http.post(`${BASE_URL}/cart/items`, JSON.stringify({ productId, quantity: 1 }), {
			headers: headers(jwt),
			tags: { name: 'POST /cart/items' },
		}),
		cartDuration,
	);
	const res = http.post(
		`${BASE_URL}/cart/checkout`,
		JSON.stringify({
			items: [{ productId }],
			shippingAddress: {
				recipientName: 'Load Test',
				recipientPhone: '0900000000',
				addressLine1: '1 Test Street',
				city: 'Ho Chi Minh',
				country: 'VN',
			},
		}),
		{
			headers: headers(jwt, { 'x-idempotency-key': uuidv4() }),
			tags: { name: 'POST /cart/checkout' },
			// 400/409/422 = bị từ chối theo nghiệp vụ (vd hết hàng), không phải lỗi server.
			responseCallback: http.expectedStatuses({ min: 200, max: 299 }, ...CHECKOUT_REJECTED),
		},
	);
	checkoutDuration.add(res.timings.duration);
	serverErrors.add(isServerError(res.status));
	if (CHECKOUT_REJECTED.includes(res.status)) {
		checkoutRejected.add(1);
		return;
	}
	if (res.status < 200 || res.status >= 300) return;
	checkoutOk.add(1);

	const orderId = res.json('data.orderId');
	if (orderId) payAndMaybeCancel(orderId, jwt);
}

// Nghiệp vụ bị từ chối (đơn đã hết hạn hoặc đổi trạng thái) không phải lỗi server nên không tính vào lt_server_errors.
const PAY_REJECTED = [400, 404, 409];

function payAndMaybeCancel(orderId, jwt) {
	if (Math.random() >= PAY_RATIO) return; // bỏ dở: đơn tự hết hạn và trả kho

	// Chốt kiểm tra còn hàng trước khi cho thanh toán; trả về paymentUrl trỏ tới simulator.
	const linkRes = http.get(`${BASE_URL}/orders/${orderId}/pay`, {
		headers: headers(jwt),
		tags: { name: 'GET /orders/:id/pay' },
		responseCallback: http.expectedStatuses({ min: 200, max: 299 }, ...PAY_REJECTED),
	});
	payLinkDuration.add(linkRes.timings.duration);
	serverErrors.add(isServerError(linkRes.status));
	if (linkRes.status < 200 || linkRes.status >= 300) return;

	// paymentUrl dùng host công khai (PUBLIC_API_BASE_URL) có thể không với tới được từ container k6: chỉ lấy intentId.
	const match = /simulator\/pay\/([0-9a-fA-F-]{36})/.exec(linkRes.json('data.paymentUrl') || '');
	if (!match) return;

	sleep(0.5 + Math.random());
	const payRes = http.post(`${BASE_URL}/simulator/pay/${match[1]}/success`, null, {
		headers: { 'x-api-key': API_KEY },
		tags: { name: 'POST /simulator/pay/:intentId/success' },
		responseCallback: http.expectedStatuses({ min: 200, max: 299 }, ...PAY_REJECTED),
	});
	payDuration.add(payRes.timings.duration);
	serverErrors.add(isServerError(payRes.status));
	if (payRes.status === 404) payUnavailable.add(1);
	if (payRes.status < 200 || payRes.status >= 300) return;
	orderPaid.add(1);

	if (Math.random() >= CANCEL_RATIO) return;
	sleep(1 + Math.random());
	const cancelRes = http.post(`${BASE_URL}/orders/${orderId}/cancel`, null, {
		headers: headers(jwt),
		tags: { name: 'POST /orders/:id/cancel' },
		// 409 = đơn đã chuyển SHIPPED trước khi huỷ kịp (đua hợp lệ); 400/404 = trạng thái không cho huỷ.
		responseCallback: http.expectedStatuses({ min: 200, max: 299 }, ...PAY_REJECTED),
	});
	cancelDuration.add(cancelRes.timings.duration);
	serverErrors.add(isServerError(cancelRes.status));
	if (cancelRes.status >= 200 && cancelRes.status < 300) orderCancelled.add(1);
}

export default function (data) {
	const user = users[(__VU - 1) % users.length];

	if (PROFILE === 'auth') {
		login(user);
		sleep(1);
		return;
	}

	const jwt = ensureToken(user);
	if (!jwt) {
		sleep(5);
		return;
	}

	const [wBrowse, wCart] = PROFILES[PROFILE];
	const roll = Math.random() * 100;
	if (roll < wBrowse) browse(data.productIds, jwt);
	else if (roll < wBrowse + wCart) cart(data.productIds, jwt);
	else checkout(data.productIds, jwt);

	sleep(1 + Math.random() * 2);
}
