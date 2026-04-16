// Common row types shared between routes and app rendering
export interface CategoryRow {
    id: number;
    name: string;
    count: number;
}

export interface CategoryEditRow {
    id: number;
    name: string;
}

export interface BookmarkRow {
    id: number;
    url: string;
    title: string;
    category_name: string | null;
    created_at: string;
    check_status: string;
    last_checked_at: string | null;
    check_http_code: number | null;
    check_error: string | null;
}

export interface BookmarkEditRow {
    id: number;
    url: string;
    title: string;
    category_id: number | null;
}

// Small parsing helpers used by route modules
export function toInt(val: unknown): number | null {
    if (typeof val === 'number' && Number.isInteger(val)) return val;
    if (typeof val === 'string') {
        if (val.trim() === '') return null;
        const num = Number(val);
        if (Number.isInteger(num)) return num;
    }
    return null;
}

export function toIntClamp(val: unknown, min: number, max: number, fallback: number): number {
    const n = toInt(val);
    if (n === null) return fallback;
    return Math.min(Math.max(n, min), max);
}

export function validateStringLength(str: string, maxLen: number, fieldName: string): void {
    if (str.length > maxLen) {
        throw new Error(`${fieldName}长度不能超过 ${maxLen} 字符`);
    }
}
