import { AICapability } from '../../packages/sdk/index';

/**
 * 模型能力的显示标签映射
 */
export const CAPABILITY_LABELS: Record<AICapability, string> = {
    'dialogue': '对话',
    'vision': '视觉',
    'tool_use': '工具使用',
    'text_to_image': '文生图',
    'embedding': '嵌入向量',
    'unknown': '未知'
};

/**
 * 可供用户选择的能力列表（排除unknown）
 */
export const USER_SELECTABLE_CAPABILITIES: AICapability[] = [
    'dialogue', 
    'vision', 
    'tool_use', 
    'text_to_image', 
    'embedding'
];

/**
 * 获取能力的显示标签
 */
export function getCapabilityLabel(capability: AICapability): string {
    return CAPABILITY_LABELS[capability] || capability;
}

/**
 * 获取能力列表的显示文本
 */
export function getCapabilitiesDisplayText(capabilities: AICapability[]): string {
    if (!capabilities || capabilities.length === 0) {
        return '未配置';
    }
    return capabilities.map(c => getCapabilityLabel(c)).join(', ');
}

/**
 * 检查能力是否可由用户选择
 */
export function isUserSelectableCapability(capability: AICapability): boolean {
    return USER_SELECTABLE_CAPABILITIES.includes(capability);
} 