# Prompt gửi Claude Code — từng bước

Mở thư mục `celo-brief-agent` trong VS Code, chạy Claude Code, rồi dán **từng prompt một**.
Xong bước nào, test được rồi mới dán bước tiếp theo.

---

## Bước 0 — Cho Claude Code hiểu dự án

```
Đọc README.md, PROMPTS_CLAUDE_CODE.md và toàn bộ thư mục src/. Đây là bài dự thi hackathon "Agents Open for Business" (Loops House x Celo), nộp vào track Altana Smart Agentic Wallets (chính) và Agent Vault (phụ). Hạn nộp: 7/12/2026 09:00 GMT.

Luật bắt buộc:
- Chỉ dùng Celo mainnet (chainId 42220).
- Mọi giao dịch muốn được tính điểm phải có attribution tag ERC-8021 (Altana createClient appCode, hoặc @celo/attribution-tags).
- Agent phải đăng ký ERC-8004.
- Code phải viết từ ngày 20/11 trở đi.

Tài liệu cần đọc trước khi code (dùng web fetch):
- https://docs.altana.network/sdk/ (grant-session, execute, x402, attribution, erc8004, create-passkey-wallet, revoke-session)
- https://x402.celo.org/skill.md
- https://docs.celo.org/build-on-celo/attribution-tags
- https://docs.celo.org/build-on-celo/build-with-ai/8004
- Repo tham khảo: https://github.com/furkan3152/AUtumn và https://github.com/cezo484/agentkey

Chưa sửa code vội. Hãy tóm tắt kiến trúc, liệt kê những chỗ trong scaffold có thể sai so với API thật của SDK đã cài, rồi đề xuất thứ tự làm.
```

## Bước 1 — Cài đặt và kiểm tra API thật

```
Chạy npm install. Sau đó:
1. Kiểm tra export thật của @altananetwork/sdk, @x402/hono, @x402/core, @x402/evm, @celo/attribution-tags trong node_modules, rồi sửa import trong src/ cho đúng.
2. Xác minh địa chỉ USDT và USDC trên Celo mainnet (trong .env.example) bằng docs chính thức của Celo.
3. Chạy npm run typecheck cho đến khi không còn lỗi.
Báo lại những gì đã sửa.
```

## Bước 2 — Seller x402 (API bán bản tin)

```
Hoàn thiện src/seller/server.ts:
- GET /brief tính phí BRIEF_PRICE_USD bằng USDT trên eip155:42220, settle qua https://api.x402.celo.org kèm header X-API-Key.
- Trước tiên chạy npm run check:supported (mình đã điền X402_API_KEY vào .env) để biết scheme/asset nào được hỗ trợ, rồi cấu hình cho khớp.
- Thêm script test: gọi /brief không trả tiền phải nhận 402.
- Hướng dẫn mình expose port bằng cloudflared tunnel để có SELLER_PUBLIC_URL.
```

## Bước 3 — Thử luồng Altana bằng ví của mình

```
Viết src/scripts/devFlow.ts để test end-to-end trên mainnet bằng ví admin của chính mình (private key trong .env, chỉ dùng để test):
1. createWallet trên CELO.
2. In địa chỉ ví và chờ mình nạp khoảng 0.5 USDT và 0.1 CELO.
3. grantSession với spend cap USDT 0.05/ngày, x402Tokens: [USDT], feeToken: USDT, expiry 14 ngày. Tự tạo session key và lưu bằng serializeSession, tuyệt đối không dùng JSON.stringify với session.
4. fetchWithX402 tới SELLER_PUBLIC_URL/brief, in nội dung trả về và tx hash.
5. Chạy npm run verify:tx với tx hash vừa có để xác nhận tag "altana,vn_brief_agent,celo_...".
Nếu rail permit2 lỗi thì thử eip3009 và giải thích cho mình lý do.
```

## Bước 4 — Trang onboarding cho người dùng thật

```
Xây giao diện onboarding trong src/web (HTML + JS thuần, hoặc Vite nếu cần bundle SDK cho trình duyệt). Giao diện song ngữ tiếng Việt và tiếng Anh, chạy tốt trên điện thoại:
1. Nút "Tạo ví" gọi createPasskeyWallet: người dùng giữ passkey, mình không giữ khóa admin.
2. Hiện địa chỉ ví, nút copy, và hướng dẫn nạp USDT/CELO bằng tiền của chính họ.
3. Form cấu hình: giới hạn chi tiêu/ngày (mặc định 0.05 USDT) và số ngày hiệu lực (mặc định 14).
4. Nút "Cấp quyền cho agent" gọi grantSession trên trình duyệt, tạo session key, rồi POST lên /api/onboard.
5. Ô nhập Telegram chat id. Bot Telegram trả lời lệnh /start bằng chat id của người dùng.
6. Trang "Ví của tôi": hiện cap, expiry, link Keystore/celoscan, và nút "Thu hồi quyền" (revokeSession).
7. Checkbox đồng ý công khai tên/handle X làm "named user".
Bảo mật: chỉ chạy qua HTTPS, mã hóa key bằng SESSION_ENC_KEY, không log key ra console.
```

## Bước 5 — Agent chạy hằng ngày

```
Hoàn thiện src/agent/runner.ts:
- Mỗi ngày lúc 01:00 UTC (08:00 giờ Việt Nam), với mỗi user: gọi fetchWithX402 từ session của họ, rồi gửi bản tin vào Telegram.
- Xử lý các lỗi: spend_limit_exceeded, session hết hạn hoặc đã bị thu hồi, ví hết tiền. Báo cho user qua Telegram, không retry liên tục.
- Thêm lệnh Telegram /brief để user tự lấy bản tin ngay (vẫn tính phí, vẫn trong cap).
- Lưu log mỗi lần chạy (tx hash, thời gian) vào data/users.json để làm bằng chứng traction.
```

## Bước 6 — Đăng ký ERC-8004

```
Kiểm tra ABI thật của Identity Registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 trên Celo (lấy từ repo celo-org/agent-skills). Sửa src/scripts/register8004.ts cho đúng, kèm tag ERC-8021. Agent card nằm ở /.well-known/agent-card.json trên seller. Sau đó chạy npm run register8004 từ ví đã đăng ký bài dự thi, rồi in ra agentId.
```

## Bước 7 (phụ, làm nếu còn thời gian) — Track Agent Vault

```
Đọc trang track Agent Vault của hackathon và docs Agent Vault, rồi thêm một tính năng: agent đăng nhập vào một website thường qua Agent Vault (không nhìn thấy mật khẩu) để lấy thêm dữ liệu cho bản tin, và thanh toán x402 trên Celo. Giữ phạm vi nhỏ, chỉ làm một luồng chạy được thật.
```

## Bước 8 — Chuẩn bị nộp bài

```
Viết README.md tiếng Anh cho giám khảo:
- Vấn đề cần giải quyết, người dùng thật, kiến trúc (sơ đồ ASCII).
- Phần session key: cap, allowlist, expiry, thu hồi bằng một giao dịch.
- Địa chỉ contract, agentId ERC-8004, danh sách tx hash có tag, số ví người dùng độc lập.
- Cách chạy dự án.
Viết thêm script src/scripts/traction.ts đọc data/users.json và in bảng: số user, số lần trả phí thành công, tổng USDT, kèm link celoscan.
Sau đó rà lại toàn bộ theo SUBMISSION_CHECKLIST.md và báo cho mình mục nào còn thiếu.
```

---

### Mẹo khi dùng Claude Code
- Khi nó hỏi gì bằng tiếng Anh, bạn cứ trả lời bằng tiếng Việt. Nó hiểu.
- Trước khi chạy lệnh tốn tiền trên mainnet, dặn nó: "Giải thích lệnh này tốn bao nhiêu trước khi chạy".
- Mỗi bước xong thì `git commit`. Repo phải public từ lúc đăng ký và vẫn còn đến lúc chấm.
