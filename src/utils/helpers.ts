import iconv from 'iconv-lite';

/**
 * 将 unknown 类型转换为非负整数
 */
export function toInt(value: unknown): number | null {
    if (typeof value === 'number') {
        if (Number.isInteger(value) && value >= 0) return value;
    } else if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) return n;
    }
    return null;
}

/**
 * 将 unknown 类型转换为整数并限制范围
 */
export function toIntClamp(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : NaN;
    if (!Number.isFinite(n)) return fallback;
    const i = Math.trunc(n);
    return Math.min(max, Math.max(min, i));
}

/**
 * 验证字符串长度
 */
export function validateStringLength(value: string, maxLength: number, fieldName: string): void {
    if (value.length > maxLength) {
        throw new Error(fieldName + '长度不能超过' + maxLength + '个字符');
    }
}

/**
 * 自动检测编码并解码导入文件（支持 UTF-8 和 GBK）
 */
export function decodeImportBuffer(buf: Buffer): string {
    const utf8 = buf.toString('utf8');
    const gbk = iconv.decode(buf, 'gbk');

    const badUtf8 = (utf8.match(/\uFFFD/g) || []).length;
    const badGbk = (gbk.match(/\uFFFD/g) || []).length;

    return badGbk < badUtf8 ? gbk : utf8;
}

/**
 * 添加 flash 消息参数到 URL
 */
export function withFlash(url: string, key: 'msg' | 'err', value: string): string {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + key + '=' + encodeURIComponent(value);
}

/**
 * 安全获取重定向目标（只允许相对路径）
 */
export function safeRedirectTarget(input: unknown, fallback: string): string {
    if (typeof input !== 'string' || !input) return fallback;
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return fallback;
    if (trimmed.startsWith('//')) return fallback;
    if (trimmed.includes('\r') || trimmed.includes('\n')) return fallback;
    return trimmed;
}
