/**
 * Verdict 验证规则集
 *
 * 为 HarnessEvaluator 评估输出和 QA 验证输出提供格式约束验证，
 * 确保评估结果包含必需的标记和原因说明。
 */
/**
 * Rule 1: verdictResultMarker (severity: error)
 * 评估输出必须包含 EVALUATION_RESULT: PASS 或 EVALUATION_RESULT: NOPASS 标记
 */
export const verdictResultMarker = {
    id: 'verdict-result-marker',
    description: '评估输出必须包含 EVALUATION_RESULT: PASS 或 EVALUATION_RESULT: NOPASS 标记',
    severity: 'error',
    check: (output) => {
        if (typeof output !== 'string') {
            return {
                ruleId: 'verdict-result-marker',
                severity: 'error',
                message: '输出不是字符串类型，无法检测 EVALUATION_RESULT 标记',
                value: typeof output,
            };
        }
        const trimmed = output.trim();
        if (trimmed.length === 0) {
            return {
                ruleId: 'verdict-result-marker',
                severity: 'error',
                message: '输出为空字符串，无法检测 EVALUATION_RESULT 标记',
            };
        }
        const passMatch = /EVALUATION_RESULT\s*:\s*PASS/i.test(trimmed);
        const nopassMatch = /EVALUATION_RESULT\s*:\s*NOPASS/i.test(trimmed);
        if (passMatch || nopassMatch) {
            return null;
        }
        return {
            ruleId: 'verdict-result-marker',
            severity: 'error',
            message: '输出中未包含 EVALUATION_RESULT: PASS 或 EVALUATION_RESULT: NOPASS 标记',
            value: trimmed.slice(0, 200),
        };
    },
};
/**
 * Rule 2: verdictHasReason (severity: warning)
 * 评估输出应包含原因说明章节
 */
export const verdictHasReason = {
    id: 'verdict-has-reason',
    description: '评估输出应包含原因说明章节（## 原因 或 EVALUATION_REASON）',
    severity: 'warning',
    check: (output) => {
        if (typeof output !== 'string') {
            return {
                ruleId: 'verdict-has-reason',
                severity: 'warning',
                message: '输出不是字符串类型，无法检测原因说明',
                value: typeof output,
            };
        }
        const trimmed = output.trim();
        if (trimmed.length === 0) {
            return {
                ruleId: 'verdict-has-reason',
                severity: 'warning',
                message: '输出为空字符串，无法检测原因说明',
            };
        }
        const reasonPatterns = [
            /EVALUATION_REASON\s*:/i,
            /##\s*原因/i,
            /##\s*Reason/i,
            /原因[:：]/i,
        ];
        const hasReason = reasonPatterns.some(p => p.test(trimmed));
        if (hasReason) {
            return null;
        }
        return {
            ruleId: 'verdict-has-reason',
            severity: 'warning',
            message: '输出中未包含原因说明章节（缺少 EVALUATION_REASON 或 ## 原因 标记）',
        };
    },
};
/**
 * Rule 3: qaVerdictResultMarker (severity: error)
 * QA 验证输出必须包含 VERDICT: PASS 或 VERDICT: NOPASS 标记
 */
export const qaVerdictResultMarker = {
    id: 'qa-verdict-result-marker',
    description: 'QA 验证输出必须包含 VERDICT: PASS 或 VERDICT: NOPASS 标记',
    severity: 'error',
    check: (output) => {
        if (typeof output !== 'string') {
            return {
                ruleId: 'qa-verdict-result-marker',
                severity: 'error',
                message: '输出不是字符串类型，无法检测 VERDICT 标记',
                value: typeof output,
            };
        }
        const trimmed = output.trim();
        if (trimmed.length === 0) {
            return {
                ruleId: 'qa-verdict-result-marker',
                severity: 'error',
                message: '输出为空字符串，无法检测 VERDICT 标记',
            };
        }
        const passMatch = /VERDICT\s*:\s*PASS/i.test(trimmed);
        const nopassMatch = /VERDICT\s*:\s*NOPASS/i.test(trimmed);
        if (passMatch || nopassMatch) {
            return null;
        }
        return {
            ruleId: 'qa-verdict-result-marker',
            severity: 'error',
            message: '输出中未包含 VERDICT: PASS 或 VERDICT: NOPASS 标记',
            value: trimmed.slice(0, 200),
        };
    },
};
/**
 * Rule 4: qaVerdictHasReason (severity: warning)
 * QA 验证输出应包含原因说明章节
 */
export const qaVerdictHasReason = {
    id: 'qa-verdict-has-reason',
    description: 'QA 验证输出应包含原因说明章节（## 原因 或 ## 验证结果）',
    severity: 'warning',
    check: (output) => {
        if (typeof output !== 'string') {
            return {
                ruleId: 'qa-verdict-has-reason',
                severity: 'warning',
                message: '输出不是字符串类型，无法检测原因说明',
                value: typeof output,
            };
        }
        const trimmed = output.trim();
        if (trimmed.length === 0) {
            return {
                ruleId: 'qa-verdict-has-reason',
                severity: 'warning',
                message: '输出为空字符串，无法检测原因说明',
            };
        }
        const reasonPatterns = [
            /##\s*验证结果/i,
            /##\s*原因/i,
            /##\s*Reason/i,
            /原因[:：]/i,
        ];
        const hasReason = reasonPatterns.some(p => p.test(trimmed));
        if (hasReason) {
            return null;
        }
        return {
            ruleId: 'qa-verdict-has-reason',
            severity: 'warning',
            message: '输出中未包含原因说明章节（缺少 ## 验证结果 或 ## 原因 标记）',
        };
    },
};
/** 所有 Verdict 验证规则（评估阶段用） */
export const verdictValidationRules = [
    verdictResultMarker,
    verdictHasReason,
];
/** QA 验证规则（QA 阶段用） */
export const qaVerdictValidationRules = [
    qaVerdictResultMarker,
    qaVerdictHasReason,
];
