// Chuẩn bị schema cho DB load test.
// Bộ migration của dự án là các bản vá tăng dần (không có CREATE TABLE cho users/orders/products) nên không
// replay được trên DB trống. Vì vậy:
//  - DB trống: tạo bảng từ entity (schema:sync), đánh dấu các migration cũ (<= BASELINE) là đã chạy
//    (--fake), rồi chạy thật các migration mới hơn.
//  - DB đã baseline (chạy lại sau khi sửa code): chỉ chạy migration còn thiếu.
// BASELINE = timestamp của migration cuối cùng trước khi có cơ chế này (AddUserAvatarUrl).
const { execSync } = require('child_process');
const { Client } = require('pg');

const BASELINE = 1790335853906;
const typeorm = (args) => execSync(`npm run typeorm -- ${args}`, { stdio: 'inherit' });

async function isBaselined(client) {
	try {
		const res = await client.query('SELECT 1 FROM migrations WHERE timestamp = $1', [BASELINE]);
		return res.rowCount > 0;
	} catch (err) {
		if (err.code === '42P01') return false; // chưa có bảng migrations
		throw err;
	}
}

(async () => {
	const client = new Client({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT),
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
	});
	await client.connect();

	if (!(await isBaselined(client))) {
		typeorm('schema:sync');
		typeorm('migration:run --fake');
		const res = await client.query('DELETE FROM migrations WHERE timestamp > $1', [BASELINE]);
		console.log(`Unfaked ${res.rowCount} migration(s) newer than baseline`);
	}
	await client.end();
	typeorm('migration:run');
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
