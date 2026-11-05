# AGENTS.md — portrait-webgpu-base

> **打开本仓库时的第一入口。**  
> 合并自 **niantu**（适配/TS/预览）+ **three-webgpu-cap-shell**（打包/文档/bootstrap/可验证 demo）。

## 一句话

**TypeScript + Three.js WebGPU + Vite + Capacitor iOS** 竖屏手游稳健底座。  
设计空间固定 **390×844**，contain letterbox；桌面可切手机/Pad 预览；`base: './'` 保证真机资源路径。

## 入口地图

| 职责 | 文件 |
|------|------|
| Web 启动 | `index.html` → `src/main.ts`。手机和真机只走这一页 |
| 关卡 | `public/levels/`。打包时由 `src/game/packedLevels.ts` 收进程序 |
| 设计舞台 | `src/adapt/design.ts` |
| 设备预览 | `src/adapt/devicePreview.ts` |
| Safe Area | `src/adapt/safeArea.ts` + `src/style.css` |
| WebGPU | `src/create-renderer.ts` |
| 震动 JS | `src/utils/haptics.ts` |
| 震动 Swift 真源 | `plugins/native-haptics/*` |
| 震动怎么接 | `docs/HAPTICS.md` **§0 正确接入** |
| Capacitor | `capacitor.config.ts`（`contentInset: never`） |
| 构建 | `vite.config.ts`（**`base: './'`**） |
| iOS 注入 | `scripts/bootstrap-ios.mjs` |
| 音效方案（未实现） | `docs/AUDIO.md` |
| 画面零件 | `src/game/parts.ts`。中心线 `screwSpans`。规范见 `docs/PARTS.md` |
| 当前操作 | `play.ts` 收指针并每帧绘制。规则拆在 `screws.ts`（滑、挡、轮廓）、`intent.ts`（点选、松手补量）、`feedback.ts`（撞击闪、准备离场变亮）、`outline.ts`（选中描边，按下即亮）、`fall.ts`（重力离场）、`hapticsPlay.ts`（拖动震会话）。松手后盘上没有螺丝和扣，`main.ts` 弹出 `#result` |
| 手机设置 | `src/game/phoneSettings.ts`。试玩页右上角齿轮开震动测试、各档手感、缩放，以及螺丝、扣、银卡扣的粗糙度和金属度 |
| 规则 | `docs/SCREWS.md`。试玩读 `public/levels/` |

## DOM（勿拆）

```
#shell > #viewport > #app > #stage
  canvas          ← WebGPU
  #ui-root        ← 所有游戏 UI（safe padding）
#device-switcher  ← 仅桌面预览例外
```

## 硬性约定

1. **`vite` `base: './'`** — Capacitor 禁止绝对 `/assets/`  
2. **`webDir: dist`** 与 Vite `outDir` 一致  
3. **`ios.contentInset: never`** — Safe Area 只走 CSS  
4. **布局坐标 390×844**；禁止 `renderer.setSize(window.innerWidth,…)`  
5. **玩法 UI 只挂 `#ui-root`**
6. **Pad 只改外层视口**，不改 `DESIGN_*`  
7. **改 Swift 改 `plugins/native-haptics/`** 再 `ios:bootstrap`；震动接线见 `docs/HAPTICS.md`。Capacitor 8 的 `SceneDelegate` 必须 `rootViewController = BridgeViewController()`（默认 `CAPBridgeViewController` 不会注册插件）。不要用 JS `prepare()` 判断是否接上；真机 HUD 看 `plugin: true` + 点「点我震动」。  
8. **无 WebGPU 则明确失败**，不静默 WebGL  
9. **系统手势按 [docs/ENGINEERING.md](docs/ENGINEERING.md) §5b**。网页禁选字放大镜、长按菜单和系统缩放，不拦 `touchstart`。四边推迟和 WebView 回弹在 `BridgeViewController`，改 Swift 后要重编。便捷访问（底边向下把整页降到下半屏）没有公开接口，不能在 App 里关  

## 命令

```bash
npm install
npm run dev           # http://127.0.0.1:5190/
npm run build
npm run cap:sync
npm run ios:bootstrap # 首次 / 修插件
npm run ios
```

查询参数：`?preview=0|1` · `?debugFit=1`  
调试安全区：`document.body.classList.add('debug-safe-area')`

## 业务怎么加

- 外形和中心线：改 `src/game/parts.ts`，并同步 `docs/PARTS.md`。已定稿的尺寸、倒角不要跟着操作改。舞台、六色和一关里的配色在 `src/game/palette.ts`，规范在 `docs/SCREWS.md` 的颜色一节  
- 拖动和阻挡：只改 `src/game/screws.ts`，并同步 `docs/SCREWS.md`。`play.ts` 不写阻挡、离场、点选、补量、闪光或描边公式。直段和弯只从 `screwSpans` 读
- 点选和松手补量改 `intent.ts`。轮廓距离和 `releaseSlack` 仍在 `screws.ts`。离场改 `fall.ts`，闪光改 `feedback.ts`，选中描边改 `outline.ts`。描边是 WebGPU 屏幕遮罩，跟实际网格走，按下立刻全亮，松手后淡出，不含银卡扣。空白按下不占指针，另一根手指可以开始操作
- 试玩震动改 `hapticFeel.ts`（齿轮数值）和 `hapticsPlay.ts`（一次拖动一条会话）。`play.ts` 只调用 `playHaptics`。规范见 `docs/HAPTICS.md` §3.3
- 松手只读最后 100 毫秒。方向相反或这段没有沿杆移动，不补。慢于 250 设计像素/秒上限是 5%，达到则上限 20%。20% 不是保证脱离。拖的时候仍按真实接触停
- 关卡：`public/levels/`。读档在 `src/game/levelio.ts`。没有扣的数据时按 `screwLayout` 生成
- 保留：adapt / create-renderer / haptics / plugins / `base`  
- 触控：`clientToDesign` + 忽略 letterbox 外  
- 音效：按 `docs/AUDIO.md` 接入；禁止热路径 `new Audio()` / 每发一次桥  

## 刻意不做

- 银卡扣接到螺丝的弯上。卡扣只套在直杆上，滑动时锁在画面上  
- Android（可后加）  
- WebGL 静默回退  
