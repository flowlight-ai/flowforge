/**
 * @flowforge/cats-preview — WebSocket 构造器 patch 注入脚本（F120）。
 *
 * TS 移植自 clowder-ai `domains/preview/ws-patch-script.ts`（原样保留）：
 * Vite HMR client 打开 `ws://gateway:PORT/__vite_hmr` 时缺少 __preview_port，
 * gateway 无法路由 WS upgrade；此脚本 monkey-patch WebSocket 构造器，
 * 仅对已知 HMR 路径（Vite/webpack/sockjs）追加 __preview_port。
 *
 * @module @flowforge/cats-preview/ws-patch-script
 */

/** Known HMR WebSocket path prefixes across bundlers */
const HMR_PATHS = ['/__vite_hmr', '/__webpack_hmr', '/ws', '/sockjs-node'];

export function buildWsPatchScript(targetPort: number): string {
  const pathsJson = JSON.stringify(HMR_PATHS);
  return `<script data-cat-cafe-ws-patch="true">
(function(){
  var O=window.WebSocket;
  if(!O)return;
  var hmrPaths=${pathsJson};
  window.WebSocket=function(u,p){
    try{
      var o=new URL(u,location.href);
      if(o.hostname===location.hostname&&o.port===location.port&&!o.searchParams.has('__preview_port')){
        var match=hmrPaths.some(function(h){return o.pathname===h||o.pathname.startsWith(h+'/')});
        if(match){o.searchParams.set('__preview_port','${targetPort}');u=o.toString();}
      }
    }catch(e){}
    return p!==void 0?new O(u,p):new O(u);
  };
  window.WebSocket.prototype=O.prototype;
  window.WebSocket.CONNECTING=O.CONNECTING;
  window.WebSocket.OPEN=O.OPEN;
  window.WebSocket.CLOSING=O.CLOSING;
  window.WebSocket.CLOSED=O.CLOSED;
})();
</script>`;
}
