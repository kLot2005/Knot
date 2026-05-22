async function fetchData() {
    try {
        const [clustersRes, unclusteredRes] = await Promise.all([
            fetch('/api/clusters'),
            fetch('/api/unclustered')
        ]);

        const clusters = await clustersRes.json();
        const unclustered = await unclusteredRes.json();

        document.getElementById('totalClusters').innerText = clusters.length;
        document.getElementById('totalUnclustered').innerText = unclustered.length;

        renderClusters(clusters);
        renderUnclustered(unclustered);
    } catch (e) {
        console.error('Failed to fetch data', e);
    }
}

function renderClusters(clusters) {
    const grid = document.getElementById('clusterGrid');
    grid.innerHTML = '';

    if (clusters.length === 0) {
        grid.innerHTML = '<div class="loading">No clusters found.</div>';
        return;
    }

    clusters.forEach(cluster => {
        const card = document.createElement('div');
        card.className = 'card';

        const meta = document.createElement('div');
        meta.className = 'cluster-meta';
        meta.innerHTML = `<span>Cluster #${cluster.id}</span><span>${cluster.news_count} items</span>`;

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'cluster-items';

        // Show top 3 items to save space
        const displayItems = cluster.items.slice(0, 3);

        displayItems.forEach(item => {
            const div = document.createElement('div');
            div.className = 'cluster-item';
            div.innerHTML = `
                ${item.normalized_text.substring(0, 100)}...
                <span class="channel">@${item.channel_id}</span>
            `;
            itemsContainer.appendChild(div);
        });

        if (cluster.items.length > 3) {
            const more = document.createElement('div');
            more.className = 'cluster-item';
            more.style.color = 'var(--accent)';
            more.innerText = `+ ${cluster.items.length - 3} more articles...`;
            itemsContainer.appendChild(more);
        }

        card.appendChild(meta);
        card.appendChild(itemsContainer);
        grid.appendChild(card);
    });
}

function renderUnclustered(items) {
    const list = document.getElementById('unclusteredList');
    list.innerHTML = '';

    if (items.length === 0) {
        list.innerHTML = '<div class="loading">No unclustered news.</div>';
        return;
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            ${item.normalized_text.substring(0, 120)}...
            <span class="channel" style="margin-top:0.5rem">@${item.channel_id} | Raw post</span>
        `;
        list.appendChild(div);
    });
}

// Initial load
fetchData();
// Auto refresh every 30s
setInterval(fetchData, 30000);
