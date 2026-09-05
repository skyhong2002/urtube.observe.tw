// Limit the flat presentation to personal archive pages, including nested views.
export const dashboardFlatStyles = `
.yt-dashboard-content :is(.section,.card){background:transparent;border:0;border-radius:0;box-shadow:none;margin-top:18px;padding:14px 0}
.yt-dashboard-content .section-head{margin-bottom:12px}
.yt-dashboard-content :is(.ob-card,.yt-topic,.yt-short-compare-card,.yt-v3-genre,.yt-rhythm-quality,.yt-v3-processing,.yt-processing){background:transparent;border:0;border-radius:0;box-shadow:none}
.yt-dashboard-content .ob-card{padding:14px 0}
.yt-dashboard-content .yt-topic{padding:5px 12px 5px 0}
.yt-dashboard-content .yt-short-compare-card{padding:8px 0}
.yt-dashboard-content .yt-v3-interests .yt-v3-genre{padding:10px 8px}
.yt-dashboard-content .yt-v3-interests[data-tag-clouds] .yt-v3-genre{padding:10px 8px}
.yt-dashboard-content .yt-v3-cloud{min-height:110px;margin:10px 0;gap:8px 12px}
.yt-dashboard-content .yt-v3-scope{margin:6px 0}
.yt-dashboard-content :is(.yt-rhythm-quality,.yt-v3-processing,.yt-processing){padding:10px 0;margin-bottom:12px}
.yt-dashboard-content :is(.yt-channel-row,.yt-top-video):hover{background:transparent}
.yt-dashboard-content .yt-overview-dynamics{gap:18px}
.yt-dashboard-content .yt-keywords{min-height:140px;padding:4px 0}
.yt-dashboard-content .yt-recap-chapter{padding:18px 0}
.yt-dashboard-content .section .section{margin-top:10px;padding:10px 0}
`;
