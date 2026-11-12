# Hướng dẫn sửa lỗi độ tin cậy — 2026-11-12

Nguồn: review ngày 2026-11-12 trên `main` @ `bce1875`. Baseline `npm test`: 706 tests, 701 pass, **1 fail**, 4 skip.
Mỗi mục gồm: triệu chứng → nguyên nhân (file:dòng) → cách sửa → test bắt buộc → điều không được làm.
Bằng chứng tái hiện: "REPRO" = đã chạy script và thấy lỗi; "CODE" = suy ra từ đọc code.

Nguyên tắc chung khi sửa:
- Không nới lỏng kiểm tra an toàn (owner fence, quyền file, signed recovery). Mục tiêu là **phục hồi được** và **báo lỗi đúng**, không phải bỏ kiểm tra.
- Lỗi thoáng qua phải retry được; trạng thái lỗi không được "dính" vĩnh viễn trong bộ nhớ.
- Tool chẩn đoán (`connector_status`, `list_capabilities`, `inspect_workspace_recovery`, `stop_process`, `release_control`) phải luôn trả lời được, kể cả khi hệ thống đang lỗi.
- Mỗi mục là một commit nhỏ, có test RED trước rồi mới GREEN.

Thứ tự đề xuất: **3 → 4 → 9 → 8 → 1 → 2 → 5 → 6 → 7** (sửa nhỏ, tác động lớn lên trước; thay đổi vòng đời Desktop sau).

---

## 1. Tunnel/MCP thoát thì connector không tự khởi động lại (cao, CODE + log thật)

**Triệu chứng.** `desktop.log` lúc 13:36: `stdio MCP command stdout closed` → tunnel-client tự tắt. Connector offline đến khi người dùng mở lại app.

**Nguyên nhân.**
- [scripts/desktop-supervisor.mjs:84](../../scripts/desktop-supervisor.mjs) `onClose` chỉ chuyển `state="FAILED"`, `reason="CHILD_EXITED"`.
- [scripts/mac-desktop-adapter.mjs:279](../../scripts/mac-desktop-adapter.mjs) `clearInterval` khi `FAILED` → adapter thoát với exit code 0.
- [native/macos-desktop/App.swift:151](../../native/macos-desktop/App.swift) `terminationHandler` chỉ `refreshStatus()`, không khởi động lại.

**Cách sửa.**
1. Adapter: khi trạng thái cuối là `FAILED` với `reason` thuộc nhóm *có thể thử lại* (`CHILD_EXITED`, `CHILD_FAILED`, `RUNTIME_UNAVAILABLE`), đặt `process.exitCode = 75` (EX_TEMPFAIL) sau khi `publishStatus()` xong. Các lý do *không* thử lại (`SETUP_REQUIRED`, `AUTH_REJECTED`, `CONFIG_*`, `OWNER_ACTIVE`, `OWNER_RELEASE_FAILED`) giữ exit code hiện tại.
2. App.swift: trong `terminationHandler`, nếu `!quitRequested && process.terminationStatus == 75` thì lên lịch `startSupervisor()` với backoff `2s, 4s, 8s, … tối đa 60s`. Reset bộ đếm khi trạng thái `RUNNING/CONNECTED` giữ ổn định ≥ 5 phút. Hiện trạng thái "Đang kết nối lại (lần N)…".
3. Giới hạn: sau 10 lần liên tiếp thất bại thì dừng và hiện "Connector liên tục thoát; xem desktop.log".
4. Không tự restart khi người dùng đã chọn Quit hoặc khi đang `pruneRequested`.

**Test.**
- `test/desktop-supervisor.test.mjs`: child thoát với code 1 → status `FAILED/CHILD_EXITED` (giữ nguyên hành vi).
- `test/mac-desktop-adapter.test.mjs`: child exit → adapter `exitCode === 75`; `AUTH_REJECTED` → không phải 75.
- Kiểm tra thủ công trên app đã cài: `kill` tiến trình tunnel-client → app tự chạy lại trong ≤ 4s, `status.json` về `RUNNING/CONNECTED`.

**Không được làm.** Không restart bên trong `startDesktopRuntime` khi owner lock chưa được `release()` xong — phải đợi `closing` để tránh `OWNER_ACTIVE`.

---

## 2. Quit/Stop không bao giờ dừng được connector (cao, CODE)

**Nguyên nhân.** [scripts/mac-desktop-adapter.mjs:177](../../scripts/mac-desktop-adapter.mjs) `ownedWorkState: async () => "UNKNOWN"`; [desktop-supervisor.mjs:33](../../scripts/desktop-supervisor.mjs) chỉ kill khi `work === "IDLE"`. Hệ quả: Quit luôn báo `ACTIVE_WORK_UNKNOWN`; nhánh `AUTH_REJECTED` và `LOG_FAILED` gọi `stopChild()` nhưng không dừng gì.

**Cách sửa.**
1. Thêm tham số `stopChild({force})`. Các nhánh nội bộ không thể còn tác vụ hợp lệ mới (`AUTH_REJECTED`) gọi `force: true`: tunnel bị từ chối xác thực thì không nhận được call mới, tiếp tục chạy chỉ là retry vô ích.
2. Cài đặt `ownedWorkState` thật, tối thiểu:
   - đọc process journal (`ProcessJournal.list()` trên identity directory, read-only) và trả `ACTIVE` nếu có record `owner_session` hiện tại với trạng thái chưa kết thúc;
   - trả `IDLE` nếu journal đọc được và không có record đang chạy;
   - trả `UNKNOWN` chỉ khi đọc journal lỗi.
3. App.swift: khi Quit bị chặn với `ACTIVE_WORK_*`, hiện hộp thoại xác nhận "Buộc thoát (tác vụ đang chạy sẽ bị dừng)". Nếu người dùng đồng ý thì gửi tín hiệu riêng (ví dụ `SIGUSR2` đang dùng cho Pause — chọn tín hiệu khác hoặc ghi file yêu cầu) để adapter gọi `stopChild({force:true})`.

**Test.**
- Supervisor: `ownedWorkState → "IDLE"` thì child bị `SIGTERM`, kết quả `{stopped:true}`.
- `AUTH_REJECTED` thì child bị dừng dù `ownedWorkState → "UNKNOWN"`.
- Adapter: journal rỗng → `IDLE`; journal có record RUNNING của session hiện tại → `ACTIVE`; journal hỏng → `UNKNOWN`.

---

## 3. File pause-state chặn cả tool chẩn đoán (cao, REPRO — đây là test đang fail)

**Triệu chứng.** `list_capabilities` trả `DESKTOP_PAUSE_STATE_UNTRUSTED` → test `protected storage unavailable blocks truthful discovery and dispatch` fail với `Cannot read properties of undefined (reading 'fileTransactionReadbackAvailable')`.

**Nguyên nhân.**
- [src/mcp/server.ts:237](../../src/mcp/server.ts) `await isDesktopPaused()` chạy **trước** khi xét danh sách `whilePaused`, và ném lỗi cho mọi tool.
- [src/local/desktop-pause.ts](../../src/local/desktop-pause.ts) báo `UNTRUSTED` khi `process.getuid` không có, khi nlink≠1, hoặc khi inode/ctime đổi giữa `lstat` và `open` (race khi Desktop `rename` lúc bấm Pause/Resume).
- Lần ghi đầu dùng `os.link` rồi `os.unlink` ([scripts/mac-desktop-private-file.mjs:144](../../scripts/mac-desktop-private-file.mjs)) → có khoảnh khắc nlink=2.

**Cách sửa.**
1. Trong `server.ts`, đổi thứ tự:
   ```ts
   const pauseExempt = whilePaused.has(call.name) || recoveryInspectOnly;
   let desktopPaused: boolean | null;
   try { desktopPaused = await isDesktopPaused(options.identityRoot); }
   catch (e) {
     if (!pauseExempt) throw new ConnectorError("SECURITY_BLOCKED", "DESKTOP_PAUSE_STATE_UNTRUSTED");
     desktopPaused = null; // báo "không xác định" trong connector_status/list_capabilities
   }
   if (desktopPaused === true && !pauseExempt) throw new ConnectorError("SECURITY_BLOCKED", "CONNECTOR_PAUSED: …");
   ```
   Tool tạo hiệu ứng vẫn fail-closed; tool chẩn đoán luôn chạy và trả `desktopPaused: null` cùng `desktopPauseReason`.
2. Trong `desktop-pause.ts`: khi lỗi là *dev/ino/ctime mismatch* hoặc *nlink=2*, retry tối đa 3 lần cách nhau 20ms rồi mới báo `UNTRUSTED`. Không retry với lỗi uid/mode/symlink/kích thước.
3. Thêm `identityRoot` vào `options` của `createReadOnlyTools` và truyền xuống `isDesktopPaused`, để test dùng thư mục tạm thay vì `HOME` thật (liên quan mục 9).
4. App.swift cần xử lý `desktopPaused == null` (hiện "Chưa xác minh trạng thái tạm dừng").

**Test.**
- Pause file hỏng (mode 0644): `connector_status` và `list_capabilities` vẫn `ok:true`, có `desktopPaused:null`; `create_file` trả `SECURITY_BLOCKED`.
- `paused:true`: `fetch_file` chạy được, `run_command` bị chặn (giữ nguyên hành vi).
- Race: stub `lstat`/`open` trả inode khác ở lần 1, đúng ở lần 2 → kết quả đúng, không lỗi.
- Test hiện đang fail phải GREEN **mà không cần sửa test** sau khi có `identityRoot` trỏ vào thư mục tạm.

---

## 4. Một lỗi đọc journal lúc khởi động làm mọi tool trả `SESSION_INVALID` mãi mãi (cao, REPRO)

**Repro.** `store.list()` ném lỗi đúng 1 lần → 3 lần gọi `connector_status` đều trả `{"ok":false,"code":"SESSION_INVALID"}`; `list()` chỉ được gọi 1 lần.

**Nguyên nhân.**
- [src/core/durable-process.ts:60](../../src/core/durable-process.ts) `this.ready` tạo một lần trong constructor; reject thì giữ reject.
- [src/mcp/server.ts:689](../../src/mcp/server.ts) wrapper `await durable.initialize()` trước **mọi** tool; `catch` gán mã `SESSION_INVALID` khi lỗi không có `code`.

**Cách sửa.**
1. `DurableProcessManager`: thay `readonly ready` bằng hàm `ensureReady()`:
   ```ts
   private readyPromise?: Promise<void>;
   private ensureReady(): Promise<void> {
     return this.readyPromise ??= this.load().catch(error => {
       this.readyPromise = undefined; // cho phép lần sau thử lại
       throw Object.assign(new Error("PROCESS_JOURNAL_UNAVAILABLE"), {code: "PROCESS_JOURNAL_UNAVAILABLE", cause: error});
     });
   }
   ```
   Mọi chỗ đang `await this.ready` chuyển sang `await this.ensureReady()`. Giữ nguyên `initialized=false` cho đến khi load thành công, vì `resumeWorkspace` và `stopWorkspace` đang dựa vào cờ này.
2. Wrapper trong `server.ts`: chỉ `await durable.initialize()` với các tool tiến trình (`run_command`, `start_process`, `stop_process`, `list_processes`, `process_status`, `process_output`) và các tool bind/unbind có gọi `stopWorkspace`. Tool chẩn đoán không chờ; `processHistory()` báo `processHistoryState:"DEGRADED"` khi chưa sẵn sàng.
3. Sửa fallback mã lỗi ở `catch` của wrapper: lỗi không có `code` → `INTERNAL_ERROR` (kèm `message`), **không** phải `SESSION_INVALID`.

**Test.**
- Lỗi lần 1, thành công lần 2: call 1 trả `PROCESS_JOURNAL_UNAVAILABLE`, call 2 thành công, `list()` được gọi 2 lần.
- Journal lỗi liên tục: `connector_status` vẫn `ok:true`; `list_processes` trả `PROCESS_JOURNAL_UNAVAILABLE`.
- Hai call đồng thời khi đang load chỉ gây 1 lần `list()`.

---

## 5. Lock grant store còn sót → `GRANT_STORE_BUSY` vĩnh viễn (cao, REPRO)

**Repro.** Tạo sẵn `.trusted-workspaces.lock` (giả lập tiến trình bị kill khi đang ghi) → `enrollReadOnly` lần 1 và lần 2 đều `GRANT_STORE_BUSY`; không có code nào dọn file này.

**Nguyên nhân.** [src/local/grants.ts:226-228](../../src/local/grants.ts) dùng `O_EXCL` theo kiểu "file tồn tại = đang khoá" mà không ghi nội dung chủ sở hữu, và không có bước phục hồi. Khoá này được dùng bởi **hai** tiến trình: MCP server (owner-fenced) và Desktop adapter (`pruneInactiveRegistrations`, [scripts/mac-desktop-adapter.mjs:206](../../scripts/mac-desktop-adapter.mjs)), nên không thể xoá mù lúc khởi động.

**Cách sửa.**
1. Ghi lock **có nội dung, nguyên tử**: tạo file tạm `0600` chứa `{"format":"gsa-grant-lock-v1","holder":"server"|"desktop","session":"<uuid>"}`, `fsync`, rồi `fs.link(tmp, lock)` (exclusive), sau đó `unlink(tmp)`. Như vậy lock không bao giờ rỗng.
   - `holder:"server"` dùng `GSA_OWNER_SESSION`.
   - `holder:"desktop"` dùng `sessionId` của Desktop owner (adapter đang giữ `desktop-owner.lock`).
2. Phục hồi lúc khởi động, cạnh `controls.invalidateAfterOwnerFence` ở [src/mcp/runtime-bootstrap.ts:61](../../src/mcp/runtime-bootstrap.ts):
   - `holder:"server"` và `session !== owner.session` → xoá (kernel owner fence đã chứng minh server cũ đã chết).
   - `holder:"desktop"` → không đụng.
3. Adapter, sau khi lấy `desktop-owner.lock` và trước khi spawn tunnel: xoá lock `holder:"desktop"` có `session` khác session hiện tại.
4. Lock không parse được (định dạng cũ / rỗng): chỉ xoá trong bước phục hồi của server **và** khi `lstat` cho thấy nó cũ hơn lúc owner fence được lấy. Ngoài ra trả `GRANT_STORE_RECOVERY_REQUIRED` với hướng dẫn rõ ràng thay vì `GRANT_STORE_BUSY`.
5. Thêm `stale_grant_lock` vào `inspect_workspace_recovery` để người dùng thấy nguyên nhân.

**Test.**
- Lock `server` của session cũ → khởi động xong thì `enrollReadOnly` thành công.
- Lock `desktop` → server khởi động không xoá; `enroll` trả `GRANT_STORE_BUSY`.
- Lock của session hiện tại → không xoá (giống `"Current owner control lock is active"` của control lease).
- Hai writer đồng thời: chỉ một bên thắng `link`, bên kia nhận `GRANT_STORE_BUSY`.

**Không được làm.** Không dựa vào PID hay tuổi file để quyết định lock chết (đúng với nguyên tắc ở `control-lease.ts`).

---

## 6. HTTP cắt socket đúng 30s, trùng giới hạn `run_command` (trung bình, REPRO)

**Repro.** Tool chạy 31s qua `createHttpMcpServer` → client nhận `UND_ERR_SOCKET` sau 30019ms, không có response.

**Nguyên nhân.** [src/mcp/http.ts:117](../../src/mcp/http.ts) `.setTimeout(30000, socket => socket.destroy())` là timeout *không hoạt động* của socket, bao gồm cả thời gian xử lý tool. `run_command` dùng `time_limit_ms: 30000` ([src/mcp/server.ts:632](../../src/mcp/server.ts)), cộng thêm thời gian spawn/kill/ghi journal nên luôn vượt quá.

**Cách sửa.**
1. Tách timeout nhận request khỏi timeout xử lý: giữ `requestTimeout:30000` và `headersTimeout:10000`, nhưng đặt timeout socket = `MAX_TOOL_MS + 15000` (ví dụ 150s, vì `time_limit_ms` tối đa được validate là 120000).
2. Trong handler, sau khi đọc xong body, gọi `req.socket.setTimeout(0)` trong lúc chờ tool, rồi khôi phục sau khi `respond`.
3. Tuỳ chọn: thêm hằng `TOOL_DEADLINE_MS` dùng chung cho HTTP và `run_command` để hai con số không lệch nhau nữa.

**Test.** Tool giả chạy 35s → nhận đủ response JSON-RPC (đặt timeout test 60s). Client gửi header chậm hơn 10s → vẫn bị cắt (giữ bảo vệ slowloris).

---

## 7. Controller lease dễ kẹt (trung bình, CODE)

**Nguyên nhân.**
- [src/mcp/runtime-bootstrap.ts:61](../../src/mcp/runtime-bootstrap.ts) mỗi lần server khởi động thì `invalidateAfterOwnerFence` xoá lease → token của client đang làm việc thành `SESSION_INVALID` sau mỗi lần tunnel kết nối lại (càng hay xảy ra khi mục 1 có auto-restart).
- [src/local/control-lease.ts:144](../../src/local/control-lease.ts) client mất token → `SESSION_BUSY` tới 5 phút.

**Cách sửa (cần Human quyết định, ảnh hưởng mô hình bảo mật).**
- Phương án A (khuyến nghị): giữ lease qua restart nếu chưa hết hạn, vì token chỉ lưu dưới dạng SHA-256 nên không lộ. Chỉ xoá lock file cũ, không xoá lease. Tiến trình con cũ đã bị owner fence chặn nên không còn dùng được lease.
- Phương án B: thêm `acquire_control({takeover:true})` với xác nhận cục bộ trên menu bar ("Cho phép phiên mới giành quyền điều khiển?").
- Trả `expires_at` trong lỗi `SESSION_BUSY` để client biết khi nào thử lại.

**Test.** Restart server khi lease còn hạn → `renew_control` bằng token cũ vẫn thành công (phương án A). Lease hết hạn → `acquire_control` thành công ngay.

---

## 8. Mã lỗi bị ghi đè, khó chẩn đoán (trung bình, CODE)

**Nguyên nhân.**
- [src/mcp/server.ts:695](../../src/mcp/server.ts) lỗi không có `code` → `SESSION_INVALID`.
- [src/mcp/server.ts:690](../../src/mcp/server.ts) `return invoke(call)` không có `await` nên exception thoát khỏi `try/catch`.
- [src/mcp/http.ts:114](../../src/mcp/http.ts) mọi exception (trừ `SERVER_BUSY`) → `-32602 Invalid params`.

**Cách sửa.**
1. `return await invoke(call)`.
2. Fallback mã lỗi là `INTERNAL_ERROR`; chỉ dùng `SESSION_INVALID` cho `ControlLeaseError`.
3. HTTP: chỉ lỗi `INVALID_PARAMS` → `-32602`; còn lại → `-32603 Internal error` (không đưa `message` thô ra ngoài để tránh lộ path; ghi chi tiết vào stderr).
4. stdio đã trả `-32603` với message — giữ nguyên, nhưng map `INVALID_REQUEST` → `-32600` và `METHOD_NOT_FOUND` → `-32601` cho đúng JSON-RPC.

**Test.** Tool ném `Error("boom")` → kết quả `code:"INTERNAL_ERROR"`. HTTP với params sai → `-32602`; với tool ném lỗi → `-32603`.

---

## 9. Test phụ thuộc `HOME` thật (thấp, REPRO)

**Nguyên nhân.** Test trong [test/mcp-file-transaction-readback.test.ts](../../test/mcp-file-transaction-readback.test.ts) (và có thể các test khác gọi `createReadOnlyTools` không truyền thư mục) đọc `~/Library/Application Support/GSA-Localconnector/desktop/pause-state.json` của máy thật. Kết quả đổi tuỳ app Desktop đã cài hay chưa.

**Cách sửa.**
1. Sau mục 3, mọi test truyền `options.identityRoot` là thư mục tạm.
2. Thêm guard trong `test/helpers`: đặt `HOME` sang thư mục tạm cho toàn bộ tiến trình test (`process.env.HOME = tmp` trước khi import), hoặc thêm test kiểm tra không file nào dưới `HOME` thật bị mở trong suite.
3. CI: chạy `npm test` với `HOME` trỏ vào thư mục rỗng để bắt lỗi tương tự.

---

## Kiểm tra sau khi sửa

1. `npm run build && npm test` → 0 fail (test số 3 GREEN mà không sửa nội dung assert).
2. Chạy lại các script tái hiện (mục 3, 4, 5, 6) → không còn lỗi.
3. Trên app Mac đã cài (bước nghiệm thu, ngoài source CI):
   - kill tunnel-client → tự khởi động lại (mục 1);
   - Quit khi không có tác vụ → thoát được (mục 2);
   - bấm Pause/Resume liên tục trong lúc gọi `connector_status` → không có lỗi `UNTRUSTED` (mục 3).
4. Ghi bằng chứng (hash source, phiên bản runtime, thời gian) vào `docs/reports/` theo quy định của AGENTS.md; source CI không thay thế nghiệm thu trên app đã cài.
