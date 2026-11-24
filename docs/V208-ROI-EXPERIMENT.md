# Orion局部高解析体积砖实验（未上线）

## 目的

v207的光照平滑没有增加介质解析率。这个隔离实验直接以相同Orion作者场和seed在局部区域增加每轴4倍的物理采样密度；不是锐化截图或扩大旧纹理。现有正式入口仍是v207，不从实验目录加载资源。

- 物理bounds：x=[-.62,.03]，y=[-.42,.23]，z=[-.65,0]，均为local单位。
- 砖尺寸：256³ RGBA8，64MiB解压/潜在纹理预算（不含GPU驱动、light或occupancy）。
- spacing=.65/256=.0025390625，比全域2.6/256的原medium spacing细4倍；只在该ROI内等效全域1024样本/轴，不是全域1024³资产。
- 当前原medium 64MiB，若同时保留这块砖则medium合计128MiB，另需light/occupancy/shading；不能仍声称总显存80MiB。
- 原数学作者场、seed164837、CC0；非实测密度/发射率。Orion没有借用Pillars外部网格。

## 脚本与输出

运行 `python tools/experiment-orion-roi.py`（使用当前环境的bundled Python）。结果位于 `.workbuddy/v208-roi/`：

- `orion-roi-256.rgba8.bin.gz`：候选离线砖，RGB sqrtUNORM/emissionScale8，alpha线性/sigmaMax12。
- `report.json`：gzip/raw SHA、bounds、内存、作者场峰值、编码clipping比、CPU误差、时间和解释。
- `orion-roi-cpu-comparison.png`：作者float场高采样与4³box-average降采样再trilinear重建基准；不是实际正式资产对照。
- `orion-roi-packed-cpu.png`：候选砖解码后的CPU纯发光/消光图，明确包含量化与clipping。
- `orion-deployed-vs-roi-cpu.png`：左为实际部署Orion medium通过encoded-linear后平方的原采样顺序；右为候选砖在体素中心采样，使用同一ROI、曝光、射线步长。

`node tools/test-orion-roi.cjs` 验证尺寸、hash、spacing、实验未入正式manifest等。实验文件不触发正式构建替换。

## 验证定义

- 三张图均为CPU诊断：沿+Z看向-Z，256步前到后Beer–Lambert积分，没有多光源散射/光照缓存、恒星、残余detail tile、背景、Bloom或GPU。
- 两边曝光乘5且共用linear→sRGB，没有分别autoscale和锐化；放大使用nearest避免后处理凭空创造细节。
- box-average基准是同一fine field的4×4×4体素平均，再在cell centres作trilinear重建，积分ds相同，隔离空间表示差异。ROI x/y不和原全局体素格对齐，因此不能把这项叫正式资产的降采样误差。
- 实际部署资产对照单独读原gzip/raw hash校验后的medium；bounds与曝光相同，但候选高密度作者采样可能捕获原采样中心未见的峰值。超过scale8的候选分量会clip，必须看report比率；其峰值并不自动说明原资源过时。
- 平均x方向相邻sigma差只是索引空间诊断，不是物理梯度，更不是画质评分。
- 局部更细采样不证明整个非线性作者场严格带限，也不等于电影级。现有warp/窄脊可能仍产生高于新Nyquist的成分。

## 第9轮：隔离WebGL2实验入口（未GPU验收）

新增 `tools/roi-lab/`。运行 `node tools/roi-lab/server.cjs` 后打开 `http://127.0.0.1:8174/`，使用独立loopback白名单server，不参与正式build。

- 默认低档仅加载原medium；高档按钮按需下载并校验ROI gzip/raw SHA，关闭时abort加载并释放fine GPU纹理与CPU字节。
- 纯发光/消光正交shader：左原medium，右local bounds替换混合，所有6个面以.025 local feather衔接；先解码再mix，绝不叠加两份密度。
- 重新生成原medium和ROI所有encoded-nonzero支持的32³占用并集，扩一macrocell halo，Nearest R8；细节位于粗空区也不会自动被跳过。提供skip开关用于未来GPU skip-on/off对照。
- ROI内步长=.65/512，外部2.6/256，在ROI z边界拆段；1536循环上限，溢出可见紫色而非悄悄截断。当前CPU参考穿过ROI约705段。
- 中心近景/全域开关，分割线可移动；没有自阴影、light cache、stellar、Bloom或任意角度相机，不是正式renderer替代。
- 计量分开保留CPU与估算GPU：base+fine各128MiB，总约256MiB，不含framebuffer/驱动/hash/decompress暂存。`drawMs`是CPU提交时间，绝不是纯GPU帧时。
- independent review修复白名单原型继承crash、stream error、abort/lifetime/BFCache与内存低报。
- `node tools/test-roi-lab.cjs`通过坐标、6面混合、传输不叠加、步长/边界/预算、细节独有支持占用测试；`node tools/test-roi-lab-http.cjs`通过loopback路由、MIME、gzip/hash、非法path/方法保护。需要server运行后执行HTTP测试。
- 仍无BrowserSkill连接，未编译/执行真实GPU shader；kernel/HTTP测试不等于GPU验收。正式v207入口SHA未变。

## 第10轮：采样相位与分配失败修复

- 旧实验skip直接移动到macro边界会改变后续积分采样相位。现改为整数个nominal ds跳跃，在ROI的粗/细步长边界限长，不跨边界改变相位；剩余不足一步的空区正常积分。halo仍保留。
- `node tools/test-roi-skip.cjs`读取实际base/brick字节，以shader相同encoded三线性、解码、feather、步长、early-out计算CPU double参考，247条全域/ROI射线，跳过31902次原积分步，skip-on/off最大radiance/transmittance差4.5089e-14。不是GPU float数值保证；浏览器必须再验证实际图像差。
- `tex()`检测createTexture null与上传GL error并删除失败对象；macro重建先创建新纹理后释放旧纹理。fine/macro失败均清理fine、退回low，不误报就绪。
- `node tools/test-roi-failures.cjs`直接抽取真实lab helper，用mock GL注入分配失败、上传OOM、macro重建失败与过期请求，检查资源回收/低档恢复；不是实际GPU OOM测试。
- 正式构建SHA仍不变，目标尚未实现。仍需BrowserSkill connected后完成最后GPU环节，不能因CPU近零误差就称shader已验收。

## 第11轮：释放长期CPU体积副本

- 前述第9轮CPU128MiB保留预算为历史实现，现已消除：上传纹理后计算各自32³/32KiB占用图，随后清除原CPU medium引用；关闭高档清除fine占用与纹理，重新加载时重新下载/校验。
- `unionOccupancy(baseGrid,fineGrid)`逐byte OR两个已扩halo网格；膨胀对union可分配，实际部署base/brick测试证明与旧全扫描联合占用bit-for-bit相同。低档切换不扫描64MiB体积。
- 应用持有CPU引用：低档32KiB、高档64KiB；GPU估计低档64MiB、高档128MiB加32³宏纹理与dummy。不含framebuffer/驱动、gzip/hash/decompress临时峰值；JS GC实际回收由浏览器决定，不能叫实测RSS降幅。
- 初始化/高档加载按钮显示busy和禁用状态，最终成功/失败/低档同步；新增键盘/触摸range分割线控制，保留鼠标移动。
- `tools/test-roi-memory.cjs`运行真实draw/low helper验证预算、abort/delete/占用清除与control同步；failure tests新增成功upload仅保留small occupancy。skip247射线回归和正式场景content tests通过，仍非GPU。
- 当前正式场景已为v209（第9/10轮提及v207属于历史记录），实验不改变正式构建或medium。

## 第12轮：隔离自阴影／入射光可行性

- `tools/experiment-roi-light.py`新增CPU实验：读取实际packed base/ROI alpha，完整point→light线段积分，ROI内按六面feather替换sigma、ROI外保留全域base消光。3个Orion艺术光源，64³局部光网格，每光192 midpoint步，光色/功率沿用原baker。光网格相对原全域128³为2倍每轴解析率，仍比ROI sigma粗4倍；不称细丝级阴影已解决。
- 完成候选 `roi-light-rgb-direction-64.bin.gz`后主动停止旧浮点预览任务：review发现旧预览未回读packed字节、ambient错误乘定向HG、float32的1-exp弱消光相消，以及albedo与manifest不一致。保留旧脚本为原型，修正这些公式；最终可见证据改由 `tools/replay-roi-light.py`读取实际bytes生成，不用旧预览冒充缓存验收。
- `tools/finalize-roi-light.py`校验cache并重算512点首光192/384步probe，报告明确这些tau统计是稀疏点，不是全网格误差或收敛保证。元数据记光源、bounds、albedo、ambient、base/brick SHA。
- packed replay使用manifest albedo、isotropic ambient/(4π)、stable -expm1(-sigma ds)源积分、HG(g=.28)与Cartesian方向插值后归一化；total RGB缓存减ambient恢复point光只是近似，量化/clip会影响结果。
- 另125点逐光HG参考量化方向矩近似的误差：单一归一化方向矩不能保留多光源的角分布/不同颜色方向，不能宣称物理精确多重光源散射。
- 数值结果：packed raw1,572,864B/gzip1,025,781B；512首光probe的192/384步tau最大差0.00024070，ROI/base sigma路径tau最大差0.0114241（只是稀疏局部差异）；实际缓存与独立重算probe的RGB量化max0.0078294、方向分量max0.00392005，符合UNORM半LSB。probe源RGB有4.362%通道超过scale4，发生裁剪，这个缓存不应直接上线。
- 实际packed CPU图120×92（显示nearest放大2倍），加入散射的平均线性变化0.000680593，肉眼变化很克制。125点逐光HG对比单momentHG平均绝对差0.00734166/最大0.0692575（incident-times-phase单位，不是最终像素误差）。说明提高光网格解析率不能消除角分布压缩误差，下一步应比较逐光方案/更合适HDR编码，不把细光场本身当巨大画质跃升。
- 本实验只对ROI feather增加散射，场外不加；无surface closure/Bloom/星点，camera ds高于fine pitch，缓存clamp边缘，不是正式renderer等价。所有输出在 `.workbuddy/v210-roi-light/`，未修改正式shader、manifest或入口。

## 第13轮：逐光RGBA16F光学厚度缓存

- 新增 `tools/experiment-roi-tau.py`：32³ RGBA16F小端，RGB分别存三个光源tau，A=0；采样后逐光exp(-tau)、falloff与HG，ambient单独isotropic。tau无需按RGB亮度上限clip，实测probe incident最大5.1216仍保留；相同tau输入的moment/逐光比较隔离方向角压缩误差。
- 实际cache raw262144B/gzip173530B，tau范围0..0.684527，FP16中心最大误差0.000243902；256随机probe对384步路径的tau最大差0.0320769/平均0.000559393，scatter平均差0.0000598834。只是稀疏检查，不是全域误差/收敛保证；可能漏边界/高梯度。
- 三栏CPU回读图位于 `.workbuddy/v211-roi-tau/per-source-tau-cpu.png`：pure emission / same-tau momentHG / same-tau perSourceHG。同120×92和曝光1.3，768camera步，nearest2倍展示，最终moment/逐光平均线性像素差0.0000374599；肉眼很小，当前视角发光主导，不称明显画质提升。
- 32³尺寸降低是主要存储下降来源；同尺寸RGBA16F8B比原6B方案大33%，不能说half天然更省。该32³局部间距等于原全域128³光网格，不是解析率提升。逐光exp/normalize/HG成本未测GPU。
- tau三线性后exp等于transmittance几何插值，不等于transmittance线性插值；test明确tau0/2中点T=e^-1 vs(1+e^-2)/2。两种近似都需实际透射/散射误差验收。
- `tools/test-roi-tau.py`必须有artifact才成功；非循环forward/backward HG公式、HDR>4、tau衰减与几何插值不变量；读取live base/brick SHA/bounds/albedo/光源并重算256点384步probe，而不只相信report。已通过。新增输入尺寸/scale/source-count断言。metric对照仍复用sample/trace helper，不是独立算法的真值。
- RGBA16F为WebGL2可过滤采样格式；实际上传/readback/过滤精度、上下文/内存/性能仍未测。没有接入正式或lab shader，正式v209未改；BrowserSkill仍未连接。

## 第14轮GPU数值初验（非完整视觉验收）

BrowserSkill恢复后隔离lab真实WebGL2编译/link/draw及fine加载通过，glError0；1000×700 RGBA8 skip开关读回max差1byte，仅39/2800000通道变化，无精确magenta溢出，low释放后状态回归。截图/下载工具因临时目录权限os5失败，没有可展示GPU截图。该数值初验只覆盖纯发光/消光正交实验，尚不含本节光照候选。详细操作与边界见 `docs/V212-RECOVERY-GPU-CHECK.md`。历史「从未GPU编译」状态已被本次替代；整体gpuValidated仍false，不误称全部验收。

## 上线前必须完成

1. GPU实测同机位、同曝光、原资产/候选砖A/B，检查运动稳定性与8bit量化阶梯。
2. 正确的local bounds坐标映射、边界ghost texels/feather与粗细LOD切换；只能替换局部medium，不可直接把它当全域纹理，不可重复叠加密度。
3. conservative occupancy应覆盖细节新出现的emission/sigma，不能沿用粗medium的空区skip跳过细丝。
4. 精细ds按ROI spacing设置，受控积分上限；低档不加载该砖且保留正式v207路径。
5. 自阴影与方向cache一致性：若继续用粗缓存，必须说明缺乏细丝级阴影，不能把纯发光CPU图称完整最终效果。
6. 全部纹理与暂存内存预算、LRU释放、下载校验、离线包体积、许可/真实性UI。

连接恢复前不改变正式shader或manifest。GPU连接问题不影响离线验证，但仍阻止最终画质验收。
