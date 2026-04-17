export { inferDependencies, inferDependenciesBatch, } from '../dependency-engine.js';
/**
 * 将推断结果转换为 EdgeMeta 格式
 *
 * 推断依赖的置信度:
 * - file-overlap: 基于重叠文件数量，最高 0.8
 * - keyword: 基于关键词匹配，最高 0.6
 * - ai-semantic: 由 AI 模型决定
 */
export function inferredToEdgeMeta(dep) {
    let confidence;
    switch (dep.source) {
        case 'file-overlap':
            confidence = Math.min(0.5 + (dep.overlappingFiles?.length ?? 0) * 0.1, 0.8);
            break;
        case 'keyword':
            confidence = 0.6;
            break;
        case 'ai-semantic':
            confidence = 0.7;
            break;
        default:
            confidence = 0.5;
    }
    return {
        source: dep.source,
        overlappingFiles: dep.overlappingFiles,
        reason: dep.reason,
        confidence,
    };
}
