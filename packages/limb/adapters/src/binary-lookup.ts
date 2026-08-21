/**
 * 共享工具 — PATH 可执行二进制查找（EAC `shutil.which` 等价）
 */

import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

/** PATH 分隔符：Windows 为 ;（含盘符冒号，不能按 [;:] 盲切） */
const PATH_SEPARATOR = process.platform === 'win32' ? ';' : ':';

/** PATH 中是否存在可执行二进制；pathEnv 缺省读 process.env.PATH（可注入便于测试/容器） */
export function binaryInPath(binary: string, pathEnv?: string): boolean {
  const path = pathEnv ?? process.env.PATH ?? '';
  return path.split(PATH_SEPARATOR).some((dir) => {
    if (!dir) return false;
    try {
      accessSync(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
