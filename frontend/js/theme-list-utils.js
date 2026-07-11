export function filterAndSortThemes(themes, filters) {
    const search = filters.search.trim().toLocaleLowerCase('ja');
    const visibleThemes = themes.filter((theme) => {
        const matchesSearch = !search || [theme.name, theme.category || '']
            .some((value) => value.toLocaleLowerCase('ja').includes(search));
        const matchesStatus = !filters.status
            || theme.status === filters.status
            || (filters.status === 'completed' && theme.status === 'done');
        const matchesCategory = !filters.category || theme.category === filters.category;
        return matchesSearch && matchesStatus && matchesCategory;
    });

    return visibleThemes.sort((left, right) => {
        if (filters.sort === 'category-asc') {
            const leftCategory = (left.category || '').trim();
            const rightCategory = (right.category || '').trim();
            if (!leftCategory && rightCategory) return 1;
            if (leftCategory && !rightCategory) return -1;
            const categoryOrder = leftCategory.localeCompare(rightCategory, 'ja');
            return categoryOrder || left.name.localeCompare(right.name, 'ja');
        }
        if (filters.sort === 'priority-desc') return (right.priority ?? 0) - (left.priority ?? 0);
        if (filters.sort === 'status-asc') {
            const leftLabel = filters.statusLabels[left.status] || left.status;
            const rightLabel = filters.statusLabels[right.status] || right.status;
            return leftLabel.localeCompare(rightLabel, 'ja');
        }
        if (filters.sort === 'member-desc') return (right.member_count ?? 0) - (left.member_count ?? 0);
        return left.name.localeCompare(right.name, 'ja');
    });
}

export function summarizeThemeStatuses(themes) {
    return themes.reduce((counts, theme) => {
        const key = theme.status === 'done' ? 'completed' : theme.status;
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

export function getThemeCategoryTone(category) {
    const value = (category || '未設定').trim() || '未設定';
    let hash = 0;
    for (const character of value) {
        hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
    }
    return (hash % 6) + 1;
}
