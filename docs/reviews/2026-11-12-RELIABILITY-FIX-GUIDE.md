# Hướng dẫn sửa lỗi độ tin cậy — 2026-11-12

Nguồn: review ngày 2026-11-12 trên `main` @ `bce1875`. Baseline `npm test`: 706 tests, 701 pass, **1 fail**, 4 skip.
Mỗi mục gồm: triệu chứng → nguyên nhân (file:dòng) → cách sửa → test bắt buộc → điều không được làm.
Bằng chứng tái hiện: "REPRO" = đã chạy script và thấy lỗi; "CODE" = suy ra từ đọc code.

Nguyên tắc chung khi sửa:
- Không nới lỏng kiểm tra an toàn (owner fence, quyền file, signed recovery). Mục tiêu là **phục hồi được** và **báo lỗi đúng**, không phải bỏ kiểm tra.
- Lỗi thoáng qua phải retry được; trạng thái lỗi không được "dính" vĩnh viễn trong bộ nhớ.
- Tool chẩn đoán (`connector_status`, `list_capabilities`, `inspect_workspace_recovery`, `stop_process`, `release_control`) phải luôn trả lời được, kể cả khi hệ thống đang lỗi.
- Mỗi mục là một commit nhỏ, có test RED trước rồi mới GREEN.
- Số dòng được kiểm lại trên `main` @ `c389f2c` ngày 2026-11-12. Nếu hướng dẫn không khớp code, **dừng lại và hỏi**; không tự chọn cách nào nới kiểm tra an toàn.

Thứ tự đề xuất: **3 → 4 → 9 → 8 → 1 → 2 → 5 → 6 → 7** (sửa nhỏ, tác động lớn lên trước; thay đổi vòng đời Desktop sau).

---

## 1. Tunnel/MCP thoát thì connector không tự khởi động lại (cao, CODE + log thật)

**Triệu chứng.** `desktop.log` lúc 13:36: `stdio MCP command stdout closed` → tunnel-client tự tắt. Connector offline đến khi người dùng mở lại app.

**Nguyên nhân.**
- [scripts/desktop-supervisor.mjs:84](../../scripts/desktop-supervisor.mjs) `onClose` chỉ chuyển `state="FAILED"`, `reason="CHILD_EXITED"`.
- [scripts/mac-desktop-adapter.mjs:279](../../scripts/mac-desktop-adapter.mjs) `clearInterval` khi `FAILED` → adapter thoát với exit code 0.
- [native/macos-desktop/App.swift:151](../../native/macos-desktop/App.swift) `terminationHandler` chỉ `refreshStatus()`, không khởi động lại.

**Cách sửa.**
1. Adapter: khi trạng thái cuối là `FAILED` với `reason` thuộc nhóm *có thể thử lại* (`CHILD_EXITED`, `CHILD_FAILED`, `RUNTIME_UNAVAILABLE`), đặt `process.exitCode = 75` (EX_TEMPFAIL) sau khi `publishStatus()` xong. Các lý do *không* thử lại (`SETUP_REQUIRED`, `AUTH_REJECTED`, `CONFIG_*`, `OWNER_ACTIVE`, `OWNER_RELEASE_FAILED`, `DESKTOP_PAUSE_STATE_UNSAFE` ở mục 3.5) giữ exit code hiện tại. Lưu ý: lỗi khi `adapter.start()` đi qua nhánh `catch` của `main()` (adapter:265–269, hiện đặt `exitCode = 1`), không đi qua timer ở dòng 279. Cả hai đường đều phải áp dụng cùng một danh sách.
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

## 3. File pause-state: chặn cả tool chẩn đoán, lỗi không hiện và không sửa được trên App (cao, REPRO + CODE)

> **Viết lại 2026-11-12 (bản 3).** Bản trước có hai chỗ sai so với code: (a) nó nói bấm Pause/Resume sẽ "ghi lại file và sửa trạng thái", nhưng với file không an toàn thì `publish()` từ chối ghi; (b) nó nói mọi trạng thái khác `VERIFIED` đều là "tác vụ mới đang bị chặn", nhưng với `MISMATCH` thì MCP áp dụng giá trị trong file, giá trị này có thể là `paused=false`. Lần review này còn tìm thêm ba điểm: file không an toàn chặn cả khởi động, lỗi Pause/Resume bị nuốt im lặng, và bản trước tự mâu thuẫn ở yêu cầu "không sửa test". Mục này thay toàn bộ bản trước.

**Triệu chứng.**
- Test `protected storage unavailable blocks truthful discovery and dispatch` fail với `Cannot read properties of undefined (reading 'fileTransactionReadbackAvailable')`, vì `list_capabilities` trả lỗi thay vì kết quả. Chạy lại ngày 2026-11-12, test **vẫn fail dù file thật đang `0600` và hợp lệ**. Lý do: test stub `process.getuid = undefined`, và máy có cài app nên `lstat` file thật thành công, rồi rơi vào nhánh "không có uid" → `UNTRUSTED`. Máy không cài app (ENOENT) thì test pass (xem mục 9).
- File `pause-state.json` không an toàn (ví dụ mode `0644`): bấm Tạm dừng/Tiếp tục không có tác dụng gì và App không báo lỗi. Mở lại app thì connector không khởi động được, App chỉ hiện "Connector gặp lỗi khởi động."

**Nguyên nhân.**
- **3a.** [src/mcp/server.ts:237](../../src/mcp/server.ts) gọi `await isDesktopPaused()` **trước** khi xét danh sách `whilePaused` (dòng 240–252), nên khi đọc lỗi thì mọi tool đều nhận lỗi.
- **3b.** [src/local/desktop-pause.ts](../../src/local/desktop-pause.ts) dùng cùng một `Error("DESKTOP_PAUSE_STATE_UNTRUSTED")` (không có `code`, không có lý do con) cho hai loại lỗi:
  - lỗi bền: không có uid, mode khác `0600`, symlink, sai owner, nội dung sai;
  - lỗi thoáng qua khi adapter đang ghi: lần ghi đầu dùng `os.link` rồi `os.unlink` ([scripts/mac-desktop-private-file.mjs:144](../../scripts/mac-desktop-private-file.mjs)), nên có một khoảnh khắc `nlink=2`; các lần ghi sau dùng `os.rename` (dòng 150), nên ino/ctime đổi giữa `lstat` và `open`.
- **3c.** `publish()` của adapter ([scripts/mac-desktop-adapter.mjs:50–54](../../scripts/mac-desktop-adapter.mjs)) đọc file cũ bằng `readVerified` để lấy identity trước khi ghi. Helper từ chối file không phải `0600` (`leaf_info`, private-file:24) với lỗi `FILE_UNSAFE`. `publish()` chỉ bỏ qua `FILE_MISSING`, nên:
  - `setPaused()` (adapter:189) thất bại, và hai signal handler (adapter:283–284) nuốt lỗi bằng `.catch(()=>{})`: không có `publishStatus()`, nên App không biết gì;
  - `prepareProfile` (adapter:154) cũng gọi `publish()` cho file này khi khởi động. Supervisor ([scripts/desktop-supervisor.mjs:161–164](../../scripts/desktop-supervisor.mjs)) đổi mọi lỗi thành `RUNTIME_START_FAILED`, rồi adapter `main()` (adapter:266) đổi tiếp thành `RUNTIME_UNAVAILABLE`. Kết quả: file hỏng chặn cả khởi động, và lý do thật bị che mất.
- **3d.** `status.json` chỉ có `desktopPaused: this.paused` (adapter:233), tức giá trị adapter **ghi thành công gần nhất**. Trường này không cho biết MCP đang thực sự áp dụng gì.

**Quyết định thiết kế (đã chốt; gặp điểm không khớp thì dừng lại hỏi, không tự đổi).**
- **Không nới kiểm tra metadata.** File không phải `0600`, symlink, `nlink≠1`, sai owner tiếp tục bị từ chối cả khi đọc (`desktop-pause.ts`) lẫn khi ghi (`leaf_info` trong private-file helper). Không tự `chmod`, không tự xoá. Việc sửa là thao tác thủ công của người dùng (3.7).
- **Nội dung sai nhưng metadata an toàn (`INVALID_CONTENT`): đọc thì từ chối, ghi đè thì cho phép.** *(Bổ sung 2026-11-12 sau khi Codex báo không khớp.)* Code hiện tại đã làm đúng như vậy: helper chỉ kiểm metadata, không kiểm nội dung, nên `setPaused()` ghi đè được file `0600` chứa nội dung không phải JSON. Giữ nguyên hành vi này, **không** thêm kiểm tra nội dung trước khi ghi. Lý do:
  - Metadata an toàn nghĩa là file thuộc chính tài khoản người dùng, nằm trong thư mục `0700`, không phải symlink hay hardlink. Ghi đè không chạm vào file nào khác và không nới kiểm tra nào.
  - Phía đọc vẫn fail-closed: trong lúc nội dung sai, MCP coi như đang Pause (3.2).
  - Nếu chặn ghi đè thì chỉ còn cách sửa thủ công, mà không được thêm bảo vệ nào. Ghi đè bằng Tạm dừng/Tiếp tục chính là cách sửa.
  - `prepareProfile` lúc khởi động cũng ghi đè file này bằng `paused:false`. Điều này khớp với quy tắc "phiên mới luôn bắt đầu không tạm dừng" (adapter:151).
  - Câu "nội dung sai bị từ chối cả khi đọc lẫn khi ghi" trong bản trước là sai, bỏ.
- **Không xác minh được thì coi như đang Pause.** Tool trong `whilePaused` vẫn chạy, tool tạo hiệu ứng bị chặn. Không bao giờ coi `UNTRUSTED` là "không tạm dừng".
- **`MISMATCH` không có nghĩa mặc định là "đang chặn".** MCP áp dụng giá trị trong file, nên thông báo phải nói đúng giá trị đó.
- **File không tồn tại = không tạm dừng.** Đây là hành vi hiện tại của MCP (desktop-pause.ts:14), giữ nguyên. Adapter phải dùng **cùng hàm đọc** với MCP để thấy đúng cái MCP thấy.

**Cách sửa.**

**3.1 `src/local/desktop-pause.ts`: tách hàm đọc, thêm mã lỗi và retry có chọn lọc.**
```ts
export type PauseReason="UID_UNAVAILABLE"|"NOT_PRIVATE"|"LINK_COUNT"|"CHANGED_DURING_READ"|"INVALID_CONTENT"|"STAT_FAILED";
export class DesktopPauseUntrusted extends Error {
  readonly code="DESKTOP_PAUSE_STATE_UNTRUSTED";
  constructor(readonly reason:PauseReason){super("DESKTOP_PAUSE_STATE_UNTRUSTED");}
}
export type PauseFileReading={exists:false;paused:false}|{exists:true;paused:boolean};
export async function readDesktopPauseFile(file:string,opts:{attempts?:number;delayMs?:number}={}):Promise<PauseFileReading>;
export async function isDesktopPaused(identityRoot?:string):Promise<boolean>; // giữ chữ ký; gọi readDesktopPauseFile(<root>/desktop/pause-state.json) và trả .paused
```
- Map lý do: `getuid` không có → `UID_UNAVAILABLE`; không phải regular file, symlink, uid khác, mode khác `0600`, size ngoài `1..512` → `NOT_PRIVATE`; `nlink≠1` → `LINK_COUNT`; dev/ino/ctime/mtime/size đổi giữa `lstat`, `open` và sau khi đọc → `CHANGED_DURING_READ`; JSON hoặc định dạng sai → `INVALID_CONTENT`; `lstat` lỗi khác ENOENT → `STAT_FAILED`.
- Chỉ retry `LINK_COUNT` và `CHANGED_DURING_READ`: mặc định tổng cộng 3 lần, cách nhau 20ms. Không retry các lý do còn lại.
- `process.platform!=="darwin"` → `{exists:false,paused:false}` như hiện tại.
- Giữ chuỗi `UNTRUSTED` trong message, vì `test/mac-desktop-pause.test.ts` match `/UNTRUSTED/`.

**3.2 `src/mcp/server.ts`: xét miễn trừ trước, coi "không xác minh được" như đang Pause.**
```ts
// Dời hai khai báo này lên trước khi đọc pause; xoá biến recoveryInspect trùng ở dòng 254.
const whilePaused=new Set([/* giữ nguyên danh sách dòng 240–249 */]);
const recoveryInspect=call.name==="bind_workspaces"&&args.inspect_recovery===true&&Object.keys(args).length===1;
const pauseExempt=whilePaused.has(call.name)||recoveryInspect;
let desktopPaused:boolean|null,desktopPauseReason:string|null=null;
try{desktopPaused=await isDesktopPaused(options.identityRoot);}
catch(e){desktopPaused=null;desktopPauseReason=e instanceof DesktopPauseUntrusted?e.reason:"UNKNOWN";}
if(desktopPaused!==false&&!pauseExempt)throw new ConnectorError("SECURITY_BLOCKED",desktopPaused===null
  ?"DESKTOP_PAUSE_STATE_UNTRUSTED: new effects are blocked until the pause state can be verified"
  :"CONNECTOR_PAUSED: new effects are suspended by the desktop app");
```
- Thêm `identityRoot?:string` vào `options` của `createReadOnlyTools` (server.ts:96). Runtime thật không truyền, nên vẫn mặc định `identityDirectory()`.
- `connector_status` (dòng 274) và `list_capabilities` (dòng 480): thêm `desktopPauseReason` cạnh `desktopPaused`. `desktopPaused` thành `boolean|null`; nếu mô tả tool hoặc schema nói kiểu boolean thì sửa theo.
- Giữ mã lỗi `SECURITY_BLOCKED`: `test/mcp-desktop-pause.test.ts` kiểm `code==="SECURITY_BLOCKED"` và message `/CONNECTOR_PAUSED/`.

**3.3 Adapter: báo trạng thái file mà MCP thực sự thấy (`scripts/mac-desktop-adapter.mjs`).**
- Constructor nhận thêm `pauseReader=null` để test inject (cùng mẫu với `registrationPruner`). Mặc định dùng `(await import("../dist/src/local/desktop-pause.js")).readDesktopPauseFile`. Installer đã copy toàn bộ `dist/src` (mac-desktop-install.mjs:138), nên không cần thêm file vào danh sách.
- File quan sát là `path.join(this.config.directory,"pause-state.json")`, tức đúng file adapter ghi. Không tự suy ra `identityRoot`.
- Thêm `observePause()` (không bao giờ throw), gọi trong `publishStatus()` trước khi ghi:
  - không có `this.config?.directory` → `{desktopPauseState:"UNTRUSTED",desktopPauseEffective:null,desktopPauseReason:"OBSERVER_UNAVAILABLE"}`;
  - đang có ghi pause dở (`this.pauseWriteInFlight`) → trả lại `this.lastPauseObservation` (nếu chưa có thì đọc bình thường). Lý do: tránh tự đọc đúng lúc chính mình đang rename;
  - đọc được → `effective = reading.paused` (file không tồn tại → `false`); `state = effective===this.paused ? "VERIFIED" : "MISMATCH"`; `reason=null`;
  - lỗi `code==="DESKTOP_PAUSE_STATE_UNTRUSTED"` → `UNTRUSTED`, `effective=null`, `reason=error.reason`;
  - lỗi khác (ví dụ import hỏng) → `UNTRUSTED`, `effective=null`, `reason:"OBSERVER_UNAVAILABLE"`.
  Lưu kết quả vào `this.lastPauseObservation`. **Không** đổi `this.paused` theo kết quả quan sát.
- `status.json` = `{...status, desktopPaused:this.paused, desktopPauseState, desktopPauseEffective, desktopPauseReason, ...quitOutcome, ...registrationPruneOutcome, ...pauseRequestOutcome}`.
  - `desktopPaused` giữ là **boolean**, nghĩa là "giá trị ghi thành công gần nhất". Không đổi sang `null`: App đọc bằng `as? Bool ?? false`, nên `null` sẽ bị hiểu thành "không tạm dừng".
  - `desktopPauseEffective` là `true|false|null`. App phải xử lý `null` một cách tường minh.

**3.4 Adapter: báo kết quả Pause/Resume thay vì nuốt lỗi.**
- `setPaused()` giữ nguyên hợp đồng: vẫn throw (test hiện có kiểm `rejects /DESKTOP_NOT_RUNNING/`). Thứ tự bên trong: `pauseWriteInFlight=true` → `publish(...)` → `this.paused=paused` → `pauseWriteInFlight=false` (đặt trong `finally`) → `publishStatus()`.
- Thêm `requestPause(paused)`. Hàm này gọi `setPaused`, rồi ghi `this.pauseRequestOutcome={pauseRequestAttempt:++n, pauseRequestStatus:"DONE"|"FAILED", pauseRequestReason}` và `publishStatus()` trong cả hai nhánh (cùng mẫu với `pruneInactiveRegistrations`). Map lý do:
  - `FILE_UNSAFE` → `PAUSE_FILE_UNSAFE`;
  - `FILE_BUSY` hoặc `FILE_STALE` → `PAUSE_FILE_BUSY`;
  - `DESKTOP_NOT_RUNNING` giữ nguyên;
  - lỗi khác → `PAUSE_WRITE_FAILED`.
  Không đưa message hay path thô vào status.
- Signal handler SIGUSR2/SIGHUP (adapter:283–284) gọi `requestPause(true|false)`. `requestPause` không được reject.
- Lưu ý: nếu helper đã `rename` xong nhưng bước đọc lại sau đó lỗi, file đã đổi mà `this.paused` chưa đổi. Lần quan sát sau sẽ báo `MISMATCH` với `effective` đúng, và người dùng bấm lại. Đây là hành vi mong muốn, không cần cơ chế bù.

**3.5 Khởi động khi file không an toàn: báo đúng lý do, không tự restart.**
- `prepareProfile` (adapter:154): bắt lỗi của `publish()` cho `pause-state.json`; nếu `error.code==="FILE_UNSAFE"` thì `throw fail("DESKTOP_PAUSE_STATE_UNSAFE")`. Các file khác giữ nguyên.
- Supervisor (desktop-supervisor.mjs:161–164): đổi `} catch {` thành `} catch (error) {`, giữ nguyên `if (!child) await release();`, rồi `throw failure(error?.code==="DESKTOP_PAUSE_STATE_UNSAFE"?error.code:"RUNTIME_START_FAILED")`. Chỉ cho đúng mã này đi qua, không mở rộng danh sách tuỳ tiện.
- Adapter `main()` (adapter:266): `reason = ["OWNER_ACTIVE","DESKTOP_PAUSE_STATE_UNSAFE"].includes(error.code) ? error.code : "RUNTIME_UNAVAILABLE"`.
- **Liên quan mục 1:** `DESKTOP_PAUSE_STATE_UNSAFE` thuộc nhóm **không** tự restart, vì restart không sửa được file.

**3.6 `native/macos-desktop/App.swift`.**
- **Kết quả Pause/Resume.** Thêm `pauseRequested`, `pauseAttemptBaseline`, `pauseRequestedAt` theo đúng mẫu prune (dòng 158–182 và 261–269). Khi `pauseRequestAttempt > baseline`:
  - `DONE` → để luồng thường hiển thị;
  - `FAILED` → giữ thông báo ít nhất 8 giây (nhánh prune hiện chỉ hiện 1 giây rồi bị ghi đè; không lặp lại lỗi đó):
    - `PAUSE_FILE_UNSAFE`: "Không ghi được trạng thái tạm dừng: file không an toàn. Cần sửa thủ công (xem hướng dẫn)."
    - `PAUSE_FILE_BUSY`: "File tạm dừng đang bận; thử lại sau giây lát."
    - `DESKTOP_NOT_RUNNING`: "Connector không chạy; không đổi được trạng thái tạm dừng."
    - lý do khác: "Không đổi được trạng thái tạm dừng."
  - Sau 10 giây vẫn chưa có kết quả: "Chưa xác nhận được yêu cầu tạm dừng/tiếp tục."
- **Trạng thái pause.** Xét khi `state=="RUNNING"`, **trước** nhánh `paused` ở dòng 216–223:
  - Không có `desktopPauseState` (adapter cũ) → hành vi hiện tại.
  - Chỉ coi là bất thường khi giá trị khác `VERIFIED` ở **hai lần đọc liên tiếp**, để không nháy cảnh báo đúng lúc đang ghi.
  - `VERIFIED` → hành vi hiện tại.
  - `MISMATCH` với `effective==true`: "Trạng thái tạm dừng không khớp: connector đang **chặn** tác vụ mới. Bấm Tạm dừng hoặc Tiếp tục để đặt lại."
  - `MISMATCH` với `effective==false`: "Trạng thái tạm dừng không khớp: connector đang **cho phép** tác vụ mới. Bấm Tạm dừng hoặc Tiếp tục để đặt lại."
  - Với `MISMATCH`, bật **cả** hai mục Tạm dừng và Tiếp tục: file an toàn nên ghi lại được.
  - `UNTRUSTED` với lý do `INVALID_CONTENT`: "Nội dung file tạm dừng không hợp lệ; tác vụ mới bị chặn để an toàn. Bấm Tạm dừng hoặc Tiếp tục để ghi lại." **Bật** cả hai mục, vì ghi đè được (xem quyết định thiết kế).
  - `UNTRUSTED` với lý do `NOT_PRIVATE`, `LINK_COUNT`, `STAT_FAILED`, `CHANGED_DURING_READ`: "Không xác minh được file tạm dừng; tác vụ mới bị chặn để an toàn. Cần sửa thủ công (xem hướng dẫn)." **Tắt** cả hai mục, vì ghi sẽ bị helper từ chối, hoặc trạng thái đang đổi (`CHANGED_DURING_READ` sẽ tự hết ở lần đọc sau nếu chỉ là race). Câu "đang bị chặn" chỉ dùng ở đây, vì MCP đọc cùng file bằng cùng hàm và coi `UNTRUSTED` như đang Pause (3.2).
  - `UNTRUSTED` với lý do `OBSERVER_UNAVAILABLE` (lỗi phía adapter, không phải lỗi file): dùng thông báo trung tính "Không quan sát được trạng thái tạm dừng." Bật/tắt hai mục như hành vi hiện tại theo `desktopPaused`. Không khẳng định là đang chặn, vì MCP có thể vẫn đọc file bình thường.
- **Lỗi khởi động.** Trong nhánh `default:` (dòng 235–238), thêm `reason=="DESKTOP_PAUSE_STATE_UNSAFE"`: "File tạm dừng không an toàn nên connector không khởi động. Cần sửa thủ công (xem hướng dẫn)."
- **Hash (sửa lại 2026-11-12).** **Không** sửa pin ở [scripts/mac-desktop-ui.mjs:28](../../scripts/mac-desktop-ui.mjs). Bản trước nói pin này là của source hiện tại, nhưng thực ra nó thuộc profile `legacy` đã đóng băng (`mac-desktop-55ad-v1`, được `mac-desktop-508bf-v1` kế thừa), mô tả bundle đã build và ký, kèm cdhash. Nếu đổi pin, installer sẽ tưởng binary cũ khớp source mới và dùng lại nó, nên code Swift mới không bao giờ được build. Pin đã lệch với `App.swift` từ trước mục này, sau các commit `2e044f4` và `6849af3`. Vì vậy `test/mac-desktop-ui.test.mjs` (subtest `copied UI sources must reproduce the pinned intent`) đã đỏ sẵn trước khi sửa mục 3. Việc build lại UI và tạo descriptor pin mới qua quy trình build/ký thật là **một task riêng**, không thuộc mục 3.

**3.7 Hướng dẫn sửa thủ công (đưa vào tài liệu người dùng; App chỉ trỏ tới đây).**
```bash
F="$HOME/Library/Application Support/GSA-Localconnector/desktop/pause-state.json"
ls -l "$F"; cat "$F"
```
- Nếu file đúng quyền (`-rw-------`, owner là bạn, 1 link) nhưng nội dung sai: không cần dùng Terminal, chỉ cần bấm Tạm dừng hoặc Tiếp tục trên menu để ghi lại.
- Nếu chỉ sai quyền (regular file, owner là bạn, 1 link, nội dung đúng dạng `{"format":"gsa-desktop-pause-v1","paused":true}` hoặc `false`): chạy `chmod 600 "$F"`.
- Các trường hợp khác (symlink, hardlink, nội dung lạ, owner khác): chuyển file sang chỗ khác bằng `mv "$F" "$F.bad-$(date +%Y%m%d%H%M%S)"`. Khi file không còn, MCP coi là **không tạm dừng**; nếu cần tạm dừng thì bấm Tạm dừng sau đó, adapter sẽ tạo file mới `0600`.
- Nếu connector không khởi động vì lỗi này: sửa như trên rồi mở lại app. Phiên mới luôn bắt đầu ở trạng thái không tạm dừng (adapter:151).

**3.8 Test (RED trước, rồi GREEN; mỗi nhóm một commit).**
- `test/mac-desktop-pause.test.ts` (mở rộng):
  - mode `0644` → `reason==="NOT_PRIVATE"` và chỉ đọc 1 lần (gọi với `attempts:3` nhưng thời gian < 20ms, hoặc đếm qua hook);
  - stub `getuid` → `UID_UNAVAILABLE`;
  - hai hardlink + `attempts:1` → `LINK_COUNT`;
  - hai hardlink, tháo link thừa sau 5ms, gọi với `attempts:3, delayMs:20` → đọc thành công.
- MCP:
  - Test đang fail (`protected storage unavailable…`) phải GREEN **mà không sửa test**. Nó GREEN nhờ 3.2, không nhờ `identityRoot`, vì test này không truyền `options`. `list_capabilities` và `get_file_transaction` đều nằm trong `whilePaused`, nên vẫn chạy rồi bị chặn bởi kiểm tra protected storage như test mong đợi.
  - Test mới dùng `identityRoot` là thư mục tạm, file mode `0644`: `connector_status` và `list_capabilities` trả `ok:true`, `desktopPaused:null`, `desktopPauseReason:"NOT_PRIVATE"`; `fetch_file` vẫn chạy; `create_file` trả `SECURITY_BLOCKED` với message `/DESKTOP_PAUSE_STATE_UNTRUSTED/`.
  - `paused:true`: giữ nguyên `test/mcp-desktop-pause.test.ts`.
- Adapter (`test/mac-desktop-adapter.test.mjs`):
  - **Ngoại lệ có chủ đích với quy tắc "không sửa test":** ba assert `deepEqual` ở dòng 48, 73 và 80 sẽ fail vì status có thêm trường. Cách sửa: trong các test đó đặt `adapter.config.directory` và inject `pauseReader:async()=>({exists:false,paused:false})`, rồi thêm vào expected `desktopPauseState:"VERIFIED",desktopPauseEffective:false,desktopPauseReason:null`. Không đổi `deepEqual` thành so khớp một phần.
  - File `0644` thật trong thư mục tạm `0700`: `publishStatus()` → `UNTRUSTED/NOT_PRIVATE`, `desktopPaused` vẫn là boolean; `setPaused(true)` reject `FILE_UNSAFE`; `requestPause(true)` → `pauseRequestStatus:"FAILED"`, `pauseRequestReason:"PAUSE_FILE_UNSAFE"`; mode và nội dung file **không đổi**.
  - File `0600` nội dung không phải JSON (giữ hành vi hiện tại, đây là test bảo vệ): `publishStatus()` → `UNTRUSTED/INVALID_CONTENT`; `requestPause(true)` → `DONE`, file được thay bằng nội dung hợp lệ và mode vẫn `0600`; lần publish sau → `VERIFIED`, `effective:true`.
  - File hợp lệ `paused:true` trong khi `this.paused=false` → `MISMATCH`, `effective:true`; sau `requestPause(false)` → `DONE` và `VERIFIED`.
  - `pauseReader` ném lỗi thường → `publishStatus()` vẫn ghi `status.json`, với `UNTRUSTED/OBSERVER_UNAVAILABLE`.
  - Trong lúc `pauseWriteInFlight`, `publishStatus()` dùng lại `lastPauseObservation`: dùng `pauseReader` có bộ đếm, kiểm không bị gọi trong lúc ghi.
- Supervisor (`test/desktop-supervisor.test.mjs`): `prepareProfile` ném `DESKTOP_PAUSE_STATE_UNSAFE` → `startDesktopRuntime` reject với đúng mã đó; mã khác → `RUNTIME_START_FAILED`.
- Thủ công trên app đã cài: `chmod 644` file thật → menu hiện cảnh báo `UNTRUSTED` sau khoảng 2 giây, cả hai mục bị tắt. `chmod 600` → về bình thường. Bấm Tạm dừng/Tiếp tục liên tục trong lúc gọi `connector_status` → không có `UNTRUSTED` nào lọt ra.

**Không được làm.**
- Không nới kiểm tra mode/owner/link trong `mac-desktop-private-file.mjs` hay `desktop-pause.ts` để `publish()` ghi đè được file không an toàn.
- Không để `desktopPaused` trong `status.json` thành `null`.
- Không dùng câu "tác vụ mới đang bị chặn" cho `MISMATCH`.
- Không tự `chmod` hay tự xoá file, kể cả khi người dùng bấm Tạm dừng hoặc Tiếp tục.
- Không thêm kiểm tra nội dung trước khi ghi trong `publish()` hay helper. Nội dung sai với metadata an toàn phải ghi đè được.

---

## 4. Một lỗi đọc journal lúc khởi động làm mọi tool trả `SESSION_INVALID` mãi mãi (cao, REPRO)

**Repro.** `store.list()` ném lỗi đúng 1 lần → 3 lần gọi `connector_status` đều trả `{"ok":false,"code":"SESSION_INVALID"}`; `list()` chỉ được gọi 1 lần.

**Nguyên nhân.**
- [src/core/durable-process.ts:60](../../src/core/durable-process.ts) `this.ready` tạo một lần trong constructor; reject thì giữ reject.
- [src/mcp/server.ts:688](../../src/mcp/server.ts) wrapper `await durable.initialize()` trước **mọi** tool; `catch` (dòng 694) gán mã `SESSION_INVALID` khi lỗi không có `code`.

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
4. **Sửa lại 2026-11-12.** Lock không parse được (định dạng cũ hoặc rỗng) **không bao giờ bị xoá tự động**, kể cả khi so tuổi file với thời điểm lấy owner fence. Lý do: so tuổi như vậy trái với quy tắc "không dựa vào tuổi file", và lock đó có thể thuộc một adapter bản cũ vẫn đang chạy giữa lúc dọn đăng ký. Thay vào đó, các thao tác gặp lock này trả `GRANT_STORE_RECOVERY_REQUIRED` (có `code`) thay vì `GRANT_STORE_BUSY`, và `inspect_workspace_recovery` báo đây là lock không parse được để người dùng tự xoá bằng tay.
5. Thêm `stale_grant_lock` vào `inspect_workspace_recovery` để người dùng thấy nguyên nhân.
6. `withGrantLock` ném `Error("GRANT_STORE_BUSY")` không có thuộc tính `code` (grants.ts:228), trong khi adapter so `error?.code==="GRANT_STORE_BUSY"` (adapter:219). Vì vậy trên menu, lý do luôn hiện là `REGISTRATION_PRUNE_FAILED`. Sửa bằng `new ConnectorError("GRANT_STORE_BUSY", …)` (hoặc gắn `code`), cùng chỗ với mã mới `GRANT_STORE_RECOVERY_REQUIRED`.

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

**Đã quyết định (Human, 2026-11-12): chọn phương án A, cộng thêm `expires_at` trong `SESSION_BUSY`.** Lý do: connector chỉ có một người dùng, nên không có bên thứ hai tranh quyền điều khiển. Phương án B (takeover có xác nhận trên menu) không làm.

**Cách sửa.**
- Phương án A (khuyến nghị): giữ lease qua restart nếu chưa hết hạn, vì token chỉ lưu dưới dạng SHA-256 nên không lộ. Chỉ xoá lock file cũ, không xoá lease. Tiến trình con cũ đã bị owner fence chặn nên không còn dùng được lease.
- Phương án B: thêm `acquire_control({takeover:true})` với xác nhận cục bộ trên menu bar ("Cho phép phiên mới giành quyền điều khiển?").
- Trả `expires_at` trong lỗi `SESSION_BUSY` để client biết khi nào thử lại.

**Test.** Restart server khi lease còn hạn → `renew_control` bằng token cũ vẫn thành công (phương án A). Lease hết hạn → `acquire_control` thành công ngay.

---

## 8. Mã lỗi bị ghi đè, khó chẩn đoán (trung bình, CODE)

**Nguyên nhân.**
- [src/mcp/server.ts:694](../../src/mcp/server.ts) lỗi không có `code` → `SESSION_INVALID`.
- [src/mcp/server.ts:689](../../src/mcp/server.ts) `return invoke(call)` không có `await` nên exception thoát khỏi `try/catch`. (`invoke` bên trong đã có `catch` riêng, ở dòng 664–681, dùng `e.message` khi không có `code`. Vì vậy fallback `SESSION_INVALID` chủ yếu rơi vào lỗi từ `durable.initialize()` và `withControlToken`.)
- [src/mcp/http.ts:114](../../src/mcp/http.ts) mọi exception (trừ `SERVER_BUSY`) → `-32602 Invalid params`.

**Cách sửa.**
1. `return await invoke(call)`.
2. Fallback mã lỗi là `INTERNAL_ERROR`; chỉ dùng `SESSION_INVALID` cho `ControlLeaseError`.
3. HTTP: chỉ lỗi `INVALID_PARAMS` → `-32602`; còn lại → `-32603 Internal error` (không đưa `message` thô ra ngoài để tránh lộ path; ghi chi tiết vào stderr).
4. stdio đã trả `-32603` với message — giữ nguyên, nhưng map `INVALID_REQUEST` → `-32600` và `METHOD_NOT_FOUND` → `-32601` cho đúng JSON-RPC.

**Test.** Tool ném `Error("boom")` → kết quả `code:"INTERNAL_ERROR"`. HTTP với params sai → `-32602`; với tool ném lỗi → `-32603`.

---

## 9. Test phụ thuộc `HOME` thật (thấp, REPRO)

**Nguyên nhân.** Test trong [test/mcp-file-transaction-readback.test.ts](../../test/mcp-file-transaction-readback.test.ts) (và có thể các test khác gọi `createReadOnlyTools` không truyền thư mục) đọc `~/Library/Application Support/GSA-Localconnector/desktop/pause-state.json` của máy thật. Kết quả đổi tuỳ app Desktop đã cài hay chưa. Cụ thể, test này stub `process.getuid = undefined`. Nếu file thật tồn tại (dù đúng `0600`), `isDesktopPaused` ném `UNTRUSTED`; nếu không tồn tại (ENOENT) thì trả `false` và test pass. Đã xác nhận ngày 2026-11-12: file thật `0600` hợp lệ, test vẫn fail.

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
