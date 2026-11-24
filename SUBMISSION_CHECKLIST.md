# Checklist nộp bài — Agents Open for Business (hạn: 7/12, 09:00 GMT = 16:00 giờ VN)

## Đăng ký (làm ngay)
- [ ] Đăng ký trên loops.house/agents-open-for-business, nhận mã celo_xxxx rồi điền vào `CELO_ASSIGNED_CODE`
- [ ] Repo GitHub **public** ngay từ lúc đăng ký
- [ ] Đăng ký ví nhận thưởng (payout wallet)
- [ ] Đăng ký PayTo address của seller x402 (vì giao dịch x402 chưa mang được tag)
- [ ] Follow @Celo và @CeloDevs trên X
- [ ] Vào Telegram t.me/celoagenthackathons

## Kỹ thuật bắt buộc
- [ ] Mọi thứ chạy trên Celo mainnet
- [ ] Mọi tx có tag ERC-8021 (kiểm tra bằng `npm run verify:tx`)
- [ ] Agent đã đăng ký ERC-8004 từ ví đã đăng ký, **trước hạn nộp**
- [ ] Session key Altana có đủ: spend cap, allowlist, expiry, thu hồi được bằng 1 tx
- [ ] Agent tự trả phí x402 trong giới hạn cap

## Điểm chấm (mỗi mục 25%)
- [ ] Execution: chạy ổn, không lỗi vặt
- [ ] Value proposition: README nói rõ vấn đề và lợi ích
- [ ] Traction: tx có tag từ **ví độc lập** (không do bạn nạp tiền)
- [ ] Named user: ít nhất 1 người thật có tên/handle, kèm câu nhận xét

## Không được làm
- [ ] Không nạp tiền cho ví tester (sẽ không được tính)
- [ ] Không tự trade với chính mình / arbitrage (0 điểm)
- [ ] Không dùng code viết trước ngày 20/11

## Lịch
- Thứ Tư 25/11, 21:00 giờ VN: livestream Altana
- Thứ Sáu 4/12: AskBots review vòng 2 (review gửi dưới dạng GitHub issue, nhớ sửa theo)
- Thứ Hai 7/12, 16:00 giờ VN: **hạn nộp**
- Thứ Sáu 11/12: công bố kết quả
