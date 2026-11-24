# v228 真空太阳发光：移除装饰镜头光芒

用户明确拒绝v227不真实的星芒，要求太阳本身在宇宙中发光。此次方向不是继续堆镜头效果。

## 改动

- SOLAR_VACUUM_V3移除全部角向芒、横丝、ghost和屏幕叠加太阳点源。真空下太阳不额外产生宽光雾；合成只保留地球大气权重的轻微aureole，真空权重0。
- 发光唯一归属实体sphere/远距depth-tested Point。近白uCol3000/2910/2760，固定场景曝光；可见光不再使用强橙色mappedSolar假色，纹理仅弱亮度调制。
- 光球几何半径不变；中心球投影radius公式使用R/sqrt(d²-R²)，限幅2是数值/显示保护。
- 未分辨点源采用6px支撑Gaussian sigma.85pixel，uFlux=energy/3000；energy=(.45*3000*.805)*radius²/(2sigma²)，.805为现有二次limb面积平均。双倍距离能量约1/4，分辨率增加保持像素立体角归一关系；有限支撑和离散采样仍是近似。
- 删除重复screen PSF，避免source+overlay能量重复。source flux和LOD每次main renderFrame按实际drawing buffer h/fov更新，包含shot临时导出；其他场景不修改主太阳。缓冲区像素LOD取代只有CSS高度的最终判据。
- 地球焦点400km以上不套地表太阳高度门控和大气LUT，避免真空中低于local horizontal但未被球体遮挡的太阳错误熄灭。400km阈值是简化，不是完整掠过大气积分。
- 独立看太阳入口保持删除，8行星图鉴不变。

## 真实性边界

固定radiance3000与显示曝光、ACES/bloom不是SI辐射标定；加性bloom仍是显示传感器响应，非太阳外围的可发光气体。日冕不伪造成与日面同曝光可见的橙色巨雾。不宣称完成日冕MHD/真实可见光纹理反演/部分日食逐像素遮挡或统一全场景光度。resolved小日面仍可能有采样过渡，不据CPU测试声称零pop。

参考查证：NASA海王星事实页说明海王星太阳光约地球1/900（https://science.nasa.gov/neptune/neptune-facts/），与反平方原则一致。NASA corona页抓取失败，不以抓取失败内容作本轮新证据。

## 验证

- test-solar-optics执行实际参数函数：反平方、分辨率平方、有限值、无rays/ghost/streak/duplicate screen PSF；执行实际renderFrame太阳uniform/LOD块450/800/1600高度及异场景不修改。
- solar-overview实际遮挡/前后/相机/非地球门控通过；初次fixture缺R_EARTH ReferenceError，补显式真实常量后通过。
- sun-multilod7、sun-sphere-patch12、atlas实际IIFE、main-redesign、cinematic-inline、built通过；最终变更再build及sun/atlas/built通过，三个正式入口v228。
- 初次8189验证BrowserSkill start报no browser connected；以下为用户重连后的补充。

## 重连后实机（8190 / cwsq）

正式入口确认buildv228。太阳系6.6e12约44AU，pointvisible/spherefalse，GL0/failedPrograms0；采样太阳投影处RGB243/243/242，非橙色，flux约.000781（对应当时551px高）。

固定1280×800 shot绘制、解码，1.496e11/1.496e12/6.6e12/1.32e13距离均太阳投影邻域有输出；最大通道255/255/251/242；所有shot restoreErrors空、recoveryRiskfalse、GL0/failed0。邻域最大可混入背景，不拿最大值证明flux反平方。

在88AU只关闭太阳共用uCol做同步固定grade开/关差分：855×450，实际太阳引起的RGB通道总峰差101、总增量481，11像素总差>6，20px外增量0。证明点源本身不是背景恒星混淆，且该曝光/距离无大范围装饰光雾，不代表所有距离的视觉验收。

同真空场景固定grade、同post管线，glareK0/1逐像素差：changedChannels0、maxChannelDelta0、atm.12；说明真空无屏幕额外光芒。回约1AU，450pxbuffer上spherevisible/pointfalse、uCol3000/2910/2760、GL0/failed0。

截图工具仍报Windows Temp拒绝访问，未修ACL，未见完整画面图；上述GPU/像素与导出验证不等于用户审美满意或所有LOD过渡零跳变。此次只验证，未改v228代码和构建。
