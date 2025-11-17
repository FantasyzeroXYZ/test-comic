// 漫画阅读器 - 响应式版本

// 全局变量
let currentLanguageMode = 'english';
let currentWordIndex = -1;
let appendedWords = [];
let currentOriginalSentence = '';
let currentSentence = '';
let clipboardEnabled = false;
let activeTab = 'dictionary-tab';
let currentViewMode = 'responsive';
let highlightEnabled = false;
let currentPageIndex = 0;
let totalPages = 0;
let fitMode = 'auto';
let currentImages = [];
let zoomLevel = 1.0;
let currentMokuroData = null;

// Anki设置相关变量
let ankiSettings = {
    ip: '127.0.0.1',
    port: '8765',
    deck: '默认牌组',
    noteType: '基本',
    sentenceField: '句子',
    wordField: '单词',
    meaningField: '释义',
    imageField: '图片'
};

// 拖拽和缩放相关变量
let isPanning = false;
let startPanX, startPanY;
let translateX = 0, translateY = 0;
let scale = 1;
let lastScale = 1;
let isPinching = false;
let initialPinchDistance = 0;

// DOM元素引用
let dictionaryPanel, panelOverlay, panelDictionaryResult, panelSearchInput;
let panelSearchBtn, appendWordBtn, originalSentence, webSearchFrame;
let closePanelBtn, tabButtons;
let comicViewport, comicContainer;

// ZipProcessor类 - 处理漫画ZIP压缩包
class ZipProcessor {
    constructor() {
        this.zip = new JSZip();
        this.resizeTimeout = null;
        console.log('ZipProcessor初始化完成');
    }

    /**
     * 获取当前图片数据
     */
    getCurrentImageData() {
        if (currentImages && currentImages[currentPageIndex]) {
            return currentImages[currentPageIndex];
        }
        return null;
    }

    /**
     * 处理上传的ZIP文件
     */
    async processZipFile(file, onProgress = null) {
        try {
            console.log('开始处理ZIP文件:', file.name);
            
            const zip = new JSZip();
            const zipContent = await zip.loadAsync(file);
            const imageFiles = [];
            const totalFiles = Object.keys(zipContent.files).length;
            let processedFiles = 0;

            // 筛选图片文件
            for (const [filename, zipEntry] of Object.entries(zipContent.files)) {
                if (!zipEntry.dir && this.isImageFile(filename)) {
                    imageFiles.push({
                        filename,
                        zipEntry
                    });
                }
            }

            // 按文件名排序
            imageFiles.sort((a, b) => a.filename.localeCompare(b.filename));
            console.log(`找到 ${imageFiles.length} 个图片文件`);

            // 处理所有图片文件
            const results = [];
            for (const imageFile of imageFiles) {
                try {
                    const imageData = await this.processImageFile(zip, imageFile);
                    results.push(imageData);
                    
                    processedFiles++;
                    if (onProgress) {
                        onProgress(processedFiles, imageFiles.length);
                    }
                } catch (error) {
                    console.error(`处理图片失败 ${imageFile.filename}:`, error);
                }
            }

            console.log('ZIP文件处理完成');
            return results;
        } catch (error) {
            console.error('处理ZIP文件失败:', error);
            throw new Error(`ZIP文件处理失败: ${error.message}`);
        }
    }

    /**
     * 检查是否为图片文件
     */
    isImageFile(filename) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        return imageExtensions.includes(ext);
    }

    /**
     * 处理单个图片文件
     */
    async processImageFile(zip, imageFile) {
        const arrayBuffer = await imageFile.zipEntry.async('arraybuffer');
        const blob = new Blob([arrayBuffer]);
        const objectURL = URL.createObjectURL(blob);

        return {
            filename: imageFile.filename,
            objectURL: objectURL,
            blob: blob,
            arrayBuffer: arrayBuffer
        };
    }

    /**
     * 在指定容器中显示图片
     */
    displayImages(imageDataArray, container) {
        if (!container) {
            console.error('图片容器未找到');
            return;
        }

        container.innerHTML = '';
        console.log(`开始显示 ${imageDataArray.length} 张图片`);

        currentImages = imageDataArray;
        totalPages = imageDataArray.length;
        currentPageIndex = 0;

        // 确保容器可见
        container.style.display = 'block';

        imageDataArray.forEach((imageData, index) => {
            const pageWrapper = document.createElement('div');
            pageWrapper.className = 'page-wrapper';
            pageWrapper.dataset.filename = imageData.filename;
            pageWrapper.dataset.pageIndex = index;

            // 直接创建图片，不包含额外的容器
            const img = document.createElement('img');
            img.src = imageData.objectURL;
            img.alt = `漫画页面 ${index + 1} - ${imageData.filename}`;
            img.loading = 'eager';
            img.className = 'comic-image';

            // 添加加载错误处理
            img.onerror = () => {
                console.error(`图片加载失败: ${imageData.filename}`);
                img.alt = `图片加载失败: ${imageData.filename}`;
            };

            img.onload = () => {
                console.log(`图片加载成功: ${imageData.filename}, 尺寸: ${img.naturalWidth}x${img.naturalHeight}`);
                // 图片加载完成后设置响应式尺寸
                this.setResponsiveSize(img);
                
                // 如果是第一页，确保显示
                if (index === 0) {
                    this.showPage(0);
                }
            };

            // 创建SVG overlay
            const svgOverlay = document.createElement('div');
            svgOverlay.className = 'svg-overlay';
            svgOverlay.id = `svg-overlay-${index}`;

            pageWrapper.appendChild(img);
            pageWrapper.appendChild(svgOverlay);
            container.appendChild(pageWrapper);
        });

        // 更新页面指示器
        this.updatePageIndicator();

        // 添加窗口大小变化监听
        window.addEventListener('resize', () => {
            this.handleResize();
        });

        // 强制重新计算尺寸
        setTimeout(() => {
            this.handleResize();
        }, 100);
    }

    /**
     * 设置响应式图片尺寸 - 直接自适应显示到上下边界
     */
    setResponsiveSize(img) {
        const viewport = document.querySelector('.comic-viewport');
        if (!viewport) {
            console.warn('漫画视口未找到');
            return;
        }

        const viewportWidth = viewport.clientWidth;
        const viewportHeight = viewport.clientHeight;
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;

        console.log(`设置响应式尺寸: 模式=${fitMode}, 视口=${viewportWidth}x${viewportHeight}, 图片=${naturalWidth}x${naturalHeight}`);

        // 重置样式
        img.style.width = '';
        img.style.height = '';
        img.style.maxWidth = '';
        img.style.maxHeight = '';
        img.style.margin = '';
        img.style.objectFit = '';

        // 直接设置图片样式，不通过额外容器
        // PC端默认自适应到上下边界
        if (fitMode === 'auto') {
            // PC端和移动端统一处理：高度适应视口
            img.style.width = 'auto';
            img.style.height = 'auto';
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.objectFit = 'contain';
        } else {
            // 适配模式逻辑
            switch (fitMode) {
                case 'width':
                    img.style.width = '100%';
                    img.style.height = 'auto';
                    img.style.maxWidth = '100%';
                    img.style.maxHeight = '100%';
                    img.style.objectFit = 'contain';
                    break;
                case 'height':
                    img.style.width = 'auto';
                    img.style.height = '100%';
                    img.style.maxWidth = '100%';
                    img.style.maxHeight = '100%';
                    img.style.objectFit = 'contain';
                    break;
                case 'both':
                    img.style.width = 'auto';
                    img.style.height = 'auto';
                    img.style.maxWidth = '100%';
                    img.style.maxHeight = '100%';
                    img.style.objectFit = 'contain';
                    break;
            }
        }

        // 确保图片居中显示
        img.style.display = 'block';
        img.style.margin = '0 auto';
        
        console.log(`最终图片尺寸设置完成`);
        
        // 延迟更新SVG确保图片尺寸已应用
        setTimeout(() => {
            this.updateCurrentSVGOverlay();
        }, 100);
    }

    /**
     * 处理窗口大小变化
     */
    handleResize() {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        
        this.resizeTimeout = setTimeout(() => {
            const currentImg = document.querySelector(`.page-wrapper[data-page-index="${currentPageIndex}"] img`);
            if (currentImg && currentImg.complete) {
                this.setResponsiveSize(currentImg);
                setTimeout(() => {
                    this.updateCurrentSVGOverlay();
                }, 100);
            }
        }, 250);
    }

    /**
     * 更新页面指示器
     */
    updatePageIndicator() {
        const currentPageSpan = document.getElementById('current-page');
        const totalPagesSpan = document.getElementById('total-pages');
        if (currentPageSpan) currentPageSpan.textContent = currentPageIndex + 1;
        if (totalPagesSpan) totalPagesSpan.textContent = totalPages;
        
        const indicatorCurrent = document.getElementById('indicator-current');
        const indicatorTotal = document.getElementById('indicator-total');
        if (indicatorCurrent) indicatorCurrent.textContent = currentPageIndex + 1;
        if (indicatorTotal) indicatorTotal.textContent = totalPages;
    }

    /**
     * 显示指定页面
     */
    showPage(pageIndex) {
        if (pageIndex < 0 || pageIndex >= totalPages) {
            return;
        }

        const pages = document.querySelectorAll('.page-wrapper');
        
        // 隐藏所有页面
        pages.forEach(page => {
            page.classList.remove('active');
        });

        // 显示当前页面
        pages[pageIndex].classList.add('active');
        currentPageIndex = pageIndex;

        // 更新页面指示器
        this.updatePageIndicator();

        // 重置视图到自适应状态
        this.resetViewToFit();

        // 重新计算当前页面图片尺寸
        const currentImg = document.querySelector(`.page-wrapper[data-page-index="${currentPageIndex}"] img`);
        if (currentImg && currentImg.complete) {
            this.setResponsiveSize(currentImg);
        }

        // 延迟更新SVG overlay
        setTimeout(() => {
            this.updateCurrentSVGOverlay();
            
            // 移动端额外重绘确保对齐
            if (window.innerWidth <= 768) {
                setTimeout(() => {
                    this.forceRedrawSVGOverlay();
                }, 500);
            }
        }, 200);

        // 更新OCR高亮状态
        this.updateOCRHighlights();

        console.log(`显示第 ${currentPageIndex + 1} 页`);
    }

    /**
     * 重置视图到自适应状态
     */
    resetViewToFit() {
        zoomLevel = 1.0;
        scale = 1.0;
        translateX = 0;
        translateY = 0;

        if (window.comicReaderApp && window.comicReaderApp.viewController) {
            window.comicReaderApp.viewController.updateTransform();
        }

        const zoomLevelSpan = document.getElementById('zoom-level');
        if (zoomLevelSpan) {
            zoomLevelSpan.textContent = `${Math.round(zoomLevel * 100)}%`;
        }

        console.log('视图已重置到自适应状态');
    }

    /**
     * 下一页
     */
    nextPage() {
        if (currentPageIndex < totalPages - 1) {
            this.showPage(currentPageIndex + 1);
        }
    }

    /**
     * 上一页
     */
    previousPage() {
        if (currentPageIndex > 0) {
            this.showPage(currentPageIndex - 1);
        }
    }

    /**
     * 更新当前页面的SVG Overlay
     */
    updateCurrentSVGOverlay() {
        if (!currentMokuroData) return;
        
        const currentPage = currentMokuroData.pages[currentPageIndex];
        if (!currentPage) return;
        
        this.updateSVGOverlay(currentPageIndex, currentPage.blocks || []);
    }

    /**
     * 更新SVG Overlay（统一移动端和PC端OCR显示）
     */
    updateSVGOverlay(pageIndex, blocks = [], retryCount = 0) {
        if (pageIndex !== currentPageIndex) {
            console.log(`页面已切换，取消SVG更新: ${pageIndex} -> ${currentPageIndex}`);
            return;
        }

        const svgOverlay = document.getElementById(`svg-overlay-${pageIndex}`);
        if (!svgOverlay) {
            console.warn(`SVG overlay 未找到: svg-overlay-${pageIndex}`);
            return;
        }

        const img = document.querySelector(`.page-wrapper[data-page-index="${pageIndex}"] img`);
        if (!img) {
            console.warn(`图片元素未找到: pageIndex=${pageIndex}`);
            return;
        }

        // 等待图片完全加载和渲染
        if (!img.complete || img.naturalWidth === 0) {
            if (retryCount === 0) {
                console.log('图片尚未完全加载，等待加载完成');
            }
            img.onload = () => {
                this.updateSVGOverlay(pageIndex, blocks);
            };
            return;
        }

        // 获取图片的实际显示尺寸和位置
        const imgRect = img.getBoundingClientRect();
        const viewportRect = img.parentElement.getBoundingClientRect();
        
        // 计算缩放比例 - 基于图片的实际显示尺寸和原始尺寸
        const displayWidth = imgRect.width;
        const displayHeight = imgRect.height;
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;

        const scaleX = displayWidth / naturalWidth;
        const scaleY = displayHeight / naturalHeight;

        // 计算图片在视口中的偏移量
        const offsetX = imgRect.left - viewportRect.left;
        const offsetY = imgRect.top - viewportRect.top;

        console.log(`OCR坐标计算:
            图片显示尺寸=${displayWidth}x${displayHeight}
            原始尺寸=${naturalWidth}x${naturalHeight}
            缩放比例=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}
            相对偏移=(${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);

        // 创建SVG元素 - 使用视口尺寸
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", `0 0 ${viewportRect.width} ${viewportRect.height}`);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.pointerEvents = 'none';

        // 添加OCR文本块
        blocks.forEach((block, index) => {
            const [x1, y1, x2, y2] = block.box;
            
            // 应用缩放比例和偏移量
            const scaledX1 = x1 * scaleX + offsetX;
            const scaledY1 = y1 * scaleY + offsetY;
            const scaledWidth = (x2 - x1) * scaleX;
            const scaledHeight = (y2 - y1) * scaleY;

            // 边界检查
            if (scaledX1 < 0 || scaledY1 < 0 || 
                scaledX1 + scaledWidth > viewportRect.width || 
                scaledY1 + scaledHeight > viewportRect.height) {
                console.warn(`OCR块 ${index} 超出边界，已调整`);
            }

            const rect = document.createElementNS(svgNS, "rect");
            
            rect.setAttribute("x", scaledX1);
            rect.setAttribute("y", scaledY1);
            rect.setAttribute("width", scaledWidth);
            rect.setAttribute("height", scaledHeight);
            rect.setAttribute("class", "ocr-rect");
            rect.setAttribute("data-block-index", index);
            rect.setAttribute("data-text", block.lines.join(' '));

            // 确保样式正确应用
            rect.style.fill = 'rgba(255, 193, 7, 0.3)';
            rect.style.stroke = 'rgba(255, 193, 7, 0.8)';
            rect.style.strokeWidth = '2';
            rect.style.pointerEvents = 'all';
            rect.style.cursor = 'pointer';

            if (highlightEnabled) {
                rect.classList.add('highlighted');
            }

            // 添加点击和触摸事件
            const handleOCRTap = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log(`OCR区域点击: ${block.lines.join(' ')}`);
                this.handleOCRBlockClick(block);
            };

            rect.addEventListener('click', handleOCRTap);
            rect.addEventListener('touchstart', handleOCRTap, { passive: false });

            // 添加悬停效果（仅PC端）
            if (window.matchMedia("(hover: hover)").matches) {
                rect.addEventListener('mouseenter', (e) => {
                    this.showOCRTooltip(e, block.lines.join(' '));
                });
                
                rect.addEventListener('mouseleave', () => {
                    this.hideOCRTooltip();
                });
            }

            svg.appendChild(rect);
        });

        svgOverlay.innerHTML = '';
        svgOverlay.appendChild(svg);
        
        console.log(`OCR覆盖层已更新，共 ${blocks.length} 个文本块`);
    }

    /**
     * 强制重绘SVG覆盖层（移动端专用）
     */
    forceRedrawSVGOverlay() {
        if (!currentMokuroData) return;
        
        const currentPage = currentMokuroData.pages[currentPageIndex];
        if (!currentPage) return;
        
        setTimeout(() => {
            this.updateSVGOverlay(currentPageIndex, currentPage.blocks || []);
        }, 300);
    }

    /**
     * 处理OCR文本块点击
     */
    handleOCRBlockClick(blockData) {
        const textContent = blockData.lines.join(' ');
        console.log('OCR文本内容:', textContent);
        
        if (window.comicReaderApp && window.comicReaderApp.mokuroParser) {
            window.comicReaderApp.mokuroParser.openDictionaryWithOCRText(textContent, blockData);
        }
    }

    /**
     * 显示OCR工具提示
     */
    showOCRTooltip(e, text) {
        if (!window.matchMedia("(hover: hover)").matches) {
            return;
        }
        
        this.hideOCRTooltip();
        
        const tooltip = document.createElement('div');
        tooltip.className = 'mokuro-tooltip';
        tooltip.innerHTML = `
            <div class="tooltip-content">
                <strong>识别文本:</strong> ${text}
                <br><small>点击打开词典查询</small>
            </div>
        `;
        
        tooltip.style.position = 'fixed';
        tooltip.style.background = 'rgba(0, 0, 0, 0.8)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '8px 12px';
        tooltip.style.borderRadius = '4px';
        tooltip.style.zIndex = '10000';
        tooltip.style.maxWidth = '300px';
        tooltip.style.fontSize = '14px';
        tooltip.style.pointerEvents = 'none';
        
        document.body.appendChild(tooltip);
        
        const x = e.clientX + 10;
        const y = e.clientY + 10;
        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
        
        e.target.dataset.currentTooltip = tooltip;
    }

    /**
     * 隐藏OCR工具提示
     */
    hideOCRTooltip() {
        const existingTooltip = document.querySelector('.mokuro-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    }

    /**
     * 更新所有OCR块的高亮状态
     */
    updateOCRHighlights() {
        const ocrRects = document.querySelectorAll('.ocr-rect');
        ocrRects.forEach(rect => {
            if (highlightEnabled) {
                rect.classList.add('highlighted');
            } else {
                rect.classList.remove('highlighted');
            }
        });
    }

    /**
     * 清理创建的Object URL，释放内存
     */
    cleanup() {
        if (currentImages) {
            currentImages.forEach(imageData => {
                if (imageData.objectURL) {
                    URL.revokeObjectURL(imageData.objectURL);
                    console.log('清理图片资源:', imageData.filename);
                }
            });
        }
    }
}

// MokuroParser类
class MokuroParser {
    constructor() {
        this.currentMokuroData = null;
        this.textBlocks = new Map(); // 存储文本块数据
        console.log('MokuroParser初始化完成');
    }

    /**
     * 打开词典面板并显示OCR文本
     */
    openDictionaryWithOCRText(ocrText, blockData = null) {
        // 确保词典面板已初始化
        if (!window.comicReaderApp || !window.comicReaderApp.dictionaryPanel) {
            console.error('词典面板未初始化');
            this.showError('词典功能未就绪');
            return;
        }

        const dictionaryPanel = window.comicReaderApp.dictionaryPanel;
        
        // 设置当前语言模式（根据文本特征判断）
        const isJapanese = this.isJapaneseText(ocrText);
        currentLanguageMode = isJapanese ? 'japanese' : 'english';
        
        // 更新原句显示
        dictionaryPanel.updateOriginalSentence(ocrText, '', currentLanguageMode);
        
        // 打开词典面板
        dictionaryPanel.openDictionaryPanel();
        
        // 如果有blockData，可以显示更多信息
        if (blockData) {
            console.log('OCR块数据:', blockData);
        }
        
        // 自动查询第一个单词（如果是英语）
        if (currentLanguageMode === 'english' && ocrText.trim()) {
            const firstWord = this.extractFirstWord(ocrText);
            if (firstWord) {
                dictionaryPanel.searchWordInPanel(firstWord);
            }
        }
        // 日语文本显示分词
        else if (currentLanguageMode === 'japanese' && ocrText.trim()) {
            dictionaryPanel.panelSearchInput.value = ocrText;
            dictionaryPanel.panelDictionaryResult.innerHTML = 
                '<div class="info">点击句子中的单词进行查询，或使用搜索框手动输入</div>';
        }
    }

    /**
     * 判断文本是否为日语
     */
    isJapaneseText(text) {
        // 日语字符范围检测
        const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
        return japaneseRegex.test(text);
    }

    /**
     * 提取第一个单词（用于英语自动查询）
     */
    extractFirstWord(text) {
        const words = text.trim().split(/\s+/);
        if (words.length > 0) {
            // 清理标点符号
            return words[0].replace(/[^\w]/g, '');
        }
        return null;
    }

    /**
     * 显示错误信息
     */
    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #f44336;
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 10000;
            max-width: 80%;
        `;
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.parentElement.removeChild(errorDiv);
            }
        }, 5000);
    }

    async parseMokuroFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    console.log('开始解析Mokuro文件');
                    const mokuroData = JSON.parse(e.target.result);
                    
                    if (!this.validateMokuroStructure(mokuroData)) {
                        throw new Error('无效的Mokuro文件格式');
                    }
                    
                    this.currentMokuroData = mokuroData;
                    currentMokuroData = mokuroData; // 设置全局变量
                    this.processTextBlocks(mokuroData);
                    console.log('Mokuro文件解析成功');
                    
                    // 创建所有页面的SVG overlay
                    this.createSVGOverlaysForAllPages(mokuroData);
                    
                    resolve(mokuroData);
                } catch (error) {
                    console.error('Mokuro文件解析失败:', error);
                    reject(new Error(`Mokuro文件解析失败: ${error.message}`));
                }
            };
            
            reader.onerror = () => {
                reject(new Error('文件读取失败'));
            };
            
            reader.readAsText(file);
        });
    }

    validateMokuroStructure(data) {
        return data && 
                data.version && 
                data.title && 
                Array.isArray(data.pages);
    }

    processTextBlocks(mokuroData) {
        this.textBlocks.clear();
        
        mokuroData.pages.forEach(page => {
            const pageKey = page.img_path;
            this.textBlocks.set(pageKey, page.blocks || []);
        });
    }

    createSVGOverlaysForAllPages(mokuroData) {
        if (!mokuroData || !mokuroData.pages) {
            console.warn('没有可用的Mokuro数据');
            return;
        }

        console.log(`为 ${mokuroData.pages.length} 个页面创建SVG overlay`);

        // 只为当前页面和前后几页创建SVG，避免一次性创建太多
        const visiblePages = this.getVisiblePageRange(mokuroData.pages.length);
        
        visiblePages.forEach(pageIndex => {
            const page = mokuroData.pages[pageIndex];
            const imageElement = this.findImageElementByPath(page.img_path);
            if (imageElement && window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                // 延迟创建，确保图片已经加载
                setTimeout(() => {
                    window.comicReaderApp.zipProcessor.updateSVGOverlay(pageIndex, page.blocks || []);
                }, pageIndex * 50); // 减少延迟时间
            }
        });
    }

    /**
     * 获取需要创建SVG的页面范围（当前页和前后2页）
     */
    getVisiblePageRange(totalPages) {
        const range = [];
        const start = Math.max(0, currentPageIndex - 2);
        const end = Math.min(totalPages - 1, currentPageIndex + 2);
        
        for (let i = start; i <= end; i++) {
            range.push(i);
        }
        
        // 确保第一页和最后一页也被包含
        if (!range.includes(0)) range.unshift(0);
        if (!range.includes(totalPages - 1)) range.push(totalPages - 1);
        
        return range;
    }

    findImageElementByPath(imagePath) {
        const images = document.querySelectorAll('.page-wrapper img');
        for (const img of images) {
            // 简化匹配逻辑，只检查文件名
            const fileName = imagePath.split('/').pop() || imagePath;
            if (img.src.includes(fileName) || img.alt.includes(fileName)) {
                return img;
            }
        }
        return null;
    }

    getPageIndexByImagePath(imagePath) {
        const pages = document.querySelectorAll('.page-wrapper');
        const fileName = imagePath.split('/').pop() || imagePath;
        
        for (let i = 0; i < pages.length; i++) {
            if (pages[i].dataset.filename.includes(fileName)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 更新所有文本块的高亮状态
     */
    updateTextBlockHighlights() {
        if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
            window.comicReaderApp.zipProcessor.updateOCRHighlights();
        }
    }

    cleanup() {
        this.textBlocks.clear();
        this.currentMokuroData = null;
        currentMokuroData = null;
    }
}

// 词典面板功能
class DictionaryPanel {
    constructor() {
        this.initElements();
        this.initEventListeners();
        console.log('DictionaryPanel初始化完成');
    }

    initElements() {
        // 获取词典面板元素 - 使用 this. 前缀
        this.dictionaryPanel = document.getElementById('dictionary-panel');
        this.panelOverlay = document.getElementById('panel-overlay');
        this.panelDictionaryResult = document.getElementById('panel-dictionary-result');
        this.panelSearchInput = document.getElementById('panel-search-input');
        this.panelSearchBtn = document.getElementById('panel-search-btn');
        this.appendWordBtn = document.getElementById('append-word-btn');
        this.originalSentence = document.getElementById('original-sentence');
        this.webSearchFrame = document.getElementById('web-search-frame');
        this.closePanelBtn = document.getElementById('close-panel');
        this.tabButtons = document.querySelectorAll('.tab-button');
        
        // 新增：Anki制卡按钮
        this.panelAnkiBtn = document.getElementById('panel-add-to-anki-btn');
        
        console.log('词典面板元素初始化完成', {
            dictionaryPanel: !!this.dictionaryPanel,
            panelOverlay: !!this.panelOverlay,
            panelSearchInput: !!this.panelSearchInput,
            panelSearchBtn: !!this.panelSearchBtn,
            closePanelBtn: !!this.closePanelBtn
        });
    }

    initEventListeners() {
        // 安全检查：确保元素存在再添加事件监听器
        if (!this.closePanelBtn || !this.panelOverlay) {
            console.error('词典面板关键元素未找到:', {
                closePanelBtn: !!this.closePanelBtn,
                panelOverlay: !!this.panelOverlay
            });
            return;
        }

        // 关闭面板
        this.closePanelBtn.addEventListener('click', () => {
            this.closeDictionaryPanel();
        });
        this.panelOverlay.addEventListener('click', () => {
            this.closeDictionaryPanel();
        });

        // 搜索功能
        if (this.panelSearchBtn && this.panelSearchInput) {
            this.panelSearchBtn.addEventListener('click', () => {
                this.handleSearch();
            });
            this.panelSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleSearch();
                }
            });
        }

        // 标签页切换
        if (this.tabButtons && this.tabButtons.length > 0) {
            this.tabButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    this.switchTab(e.target.getAttribute('data-tab'));
                });
            });
        }

        // 追加词汇
        if (this.appendWordBtn) {
            this.appendWordBtn.addEventListener('click', () => {
                this.handleAppendWord();
            });
        }

        // 添加到Anki按钮
        if (this.panelAnkiBtn) {
            this.panelAnkiBtn.addEventListener('click', () => {
                this.addCurrentWordToAnki();
            });
            console.log('Anki制卡按钮监听器已添加');
        } else {
            console.error('未找到Anki制卡按钮');
        }

        console.log('词典面板事件监听器初始化完成');
    }

    // 底部面板功能
    openDictionaryPanel() {
        if (this.dictionaryPanel && this.panelOverlay) {
            this.dictionaryPanel.classList.add('active');
            this.panelOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    // 关闭词典面板
    closeDictionaryPanel() {
        if (this.dictionaryPanel && this.panelOverlay) {
            this.dictionaryPanel.classList.remove('active');
            this.panelOverlay.classList.remove('active');
            document.body.style.overflow = '';

            // 重置追加词汇状态
            this.resetAppendedWords();
        }
    }

    // 在面板中查询英语单词
    async searchWordInPanel(word) {
        if (!word.trim()) {
            if (this.panelDictionaryResult) {
                this.panelDictionaryResult.innerHTML = '<div class="error">请输入要查询的单词</div>';
            }
            return;
        }
        
        this.openDictionaryPanel();
        if (this.panelDictionaryResult) {
            this.panelDictionaryResult.innerHTML = '<div class="loading">查询中...</div>';
        }
        if (this.panelSearchInput) {
            this.panelSearchInput.value = word;
        }
        
        if (this.activeTab === 'web-tab') {
            this.loadWebSearch(word);
        }
        // dictionary-tab 时自动查询
        else if (this.activeTab === 'dictionary-tab')  {
            try {
                const apiUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
                const response = await fetch(apiUrl);
                
                if (!response.ok) {
                    if (response.status === 404) {
                        throw new Error(`未找到单词 "${word}"`);
                    } else {
                        throw new Error(`API请求失败: ${response.status}`);
                    }
                }
                
                const data = await response.json();
                this.displayWordDataInPanel(data);
            } catch (error) {
                if (this.panelDictionaryResult) {
                    this.panelDictionaryResult.innerHTML = `<div class="error">${error.message}</div>`;
                }
                console.error('查询错误:', error);
            }
        }
    }

    // 显示单词数据
    displayWordDataInPanel(wordData) {
        if (!this.panelDictionaryResult) return;
        
        if (!wordData || !Array.isArray(wordData) || wordData.length === 0) {
            this.panelDictionaryResult.innerHTML = '<div class="error">未找到单词信息</div>';
            return;
        }
        
        const entry = wordData[0];
        let html = `
            <div class="word-header">
                <div class="word-title">${this.escapeHtml(entry.word)}</div>
            </div>
        `;
        
        if (entry.phonetics && entry.phonetics.length > 0) {
            html += `<div class="phonetics">`;
            entry.phonetics.forEach(phonetic => {
                if (phonetic.text) {
                    html += `<div class="phonetic">/${this.escapeHtml(phonetic.text)}/</div>`;
                }
            });
            html += `</div>`;
        }
        
        if (entry.meanings && entry.meanings.length > 0) {
            entry.meanings.forEach((meaning, index) => {
                html += `<div class="meaning">`;
                html += `<div class="part-of-speech">${this.escapeHtml(meaning.partOfSpeech)}</div>`;
                
                if (meaning.definitions && meaning.definitions.length > 0) {
                    html += `<div class="definitions">`;
                    meaning.definitions.forEach((def, defIndex) => {
                        html += `<div class="definition">`;
                        html += `<div class="def-text">${defIndex + 1}. ${this.escapeHtml(def.definition)}</div>`;
                        
                        if (def.example) {
                            html += `<div class="example">例句: ${this.escapeHtml(def.example)}</div>`;
                        }
                        
                        html += `</div>`;
                    });
                    html += `</div>`;
                }
                
                html += `</div>`;
            });
        }
        
        this.panelDictionaryResult.innerHTML = html;
    }

    // 更新原句显示
    updateOriginalSentence(sentence, currentWord, currentLanguageMode = 'english') {
        if (!this.originalSentence) return;
        
        if (currentLanguageMode === 'japanese') {
            this.originalSentence.innerHTML = `<span>${sentence}</span>`;
        } else {
            // 英语及其他空格分词语言
            let clickableSentence = '';
            const words = sentence.split(/(\s+)/); // 保留空格
            
            appendedWords = [];
            currentWordIndex = -1;
            
            words.forEach((word, index) => {
                if (/^\s+$/.test(word)) {
                    // 空格原样添加
                    clickableSentence += word;
                } else {
                    // 支持欧洲字母及变音符号
                    const cleanWord = word.replace(/[^\p{L}\p{M}']/gu, '');
                    const isCurrentWord = currentWord && cleanWord.toLowerCase() === currentWord.toLowerCase();
                    const wordClass = isCurrentWord ? 'sentence-word highlight selectable-word' : 'sentence-word selectable-word';
                    
                    clickableSentence += `<span class="${wordClass}" data-word="${cleanWord}" data-index="${index}">${word}</span>`;
                    
                    if (isCurrentWord && currentWordIndex === -1) {
                        currentWordIndex = index;
                        appendedWords = [cleanWord];
                    }
                }
            });

            this.originalSentence.innerHTML = clickableSentence;
        }

        currentOriginalSentence = sentence;

        // 重新绑定点击事件
        this.originalSentence.removeEventListener('click', this.handleSentenceWordClick);
        this.originalSentence.addEventListener('click', this.handleSentenceWordClick);
    }

    // 处理字幕进行的单词点击
    handleSentenceWordClick = (e) => {
        const span = e.target.closest('.sentence-word');
        if (!span) return;

        const word = span.getAttribute('data-word');
        const index = parseInt(span.getAttribute('data-index'));

        // 剪贴板功能
        if (clipboardEnabled) {
            this.copyWordToClipboard(word);
        }

        // 移除其他高亮
        this.originalSentence.querySelectorAll('.sentence-word').forEach(s => {
            s.classList.remove('highlight');
        });

        // 高亮当前点击的单词
        span.classList.add('highlight');

        // 重置状态并设置新的点击单词
        appendedWords = [word];
        currentWordIndex = index;
        if (this.panelSearchInput) {
            this.panelSearchInput.value = word;
        }

        // 执行搜索
        this.searchWordInPanel(word);
    }

    // 重置追加词汇和搜索栏
    resetAppendedWords() {
        currentWordIndex = -1;
        appendedWords = [];
        if (this.panelSearchInput) {
            this.panelSearchInput.value = '';
        }
        
        if (this.originalSentence) {
            this.originalSentence.querySelectorAll('.sentence-word').forEach(span => {
                span.classList.remove('highlight');
            });
        }
    }

    // 追加词汇功能
    handleAppendWord() {
        if (!this.originalSentence) return;
        
        const sentenceSpans = this.originalSentence.querySelectorAll('.sentence-word');
        if (!sentenceSpans.length) {
            console.log('没有可用的句子单词');
            return;
        }

        // 如果没有有效的当前索引，从第一个单词开始
        if (currentWordIndex === -1) {
            currentWordIndex = 0;
        } 

        // 如果已经是最后一个单词，不再追加
        else if (currentWordIndex >= sentenceSpans.length - 1) {
            console.log('已经是最后一个单词，无法继续追加');
            return;
        }
        // 否则移动到下一个单词
        else {
            currentWordIndex++;
        }

        const currentSpan = sentenceSpans[currentWordIndex];
        const word = currentSpan.getAttribute('data-word');

        // 更新搜索输入框
        if (this.panelSearchInput) {
            if (currentLanguageMode === 'english' && appendedWords.length > 0) {
                this.panelSearchInput.value += ' ' + word;
            } else {
                this.panelSearchInput.value += word;
            }
        }

        // 剪贴板功能
        if (clipboardEnabled) {
            this.copyWordToClipboard(this.panelSearchInput.value);
        }
        
        appendedWords.push(word);

        // 更新高亮显示 - 高亮所有已追加的单词
        sentenceSpans.forEach((span, idx) => {
            const spanWord = span.getAttribute('data-word');
            const isAppended = appendedWords.includes(spanWord);
            span.classList.toggle('highlight', isAppended && idx <= currentWordIndex);
        });

        // 执行搜索
        if (this.panelSearchInput) {
            this.searchWordInPanel(this.panelSearchInput.value);
        }
    }

    // 搜索处理
    handleSearch() {
        if (!this.panelSearchInput) return;
        
        const word = this.panelSearchInput.value.trim();
        if (!word) {
            this.showNotification('请输入要查询的单词');
            return;
        }
        
        this.searchWordInPanel(word);
    }

    // 加载网页查询
    loadWebSearch(word) {
        if (!word || !this.webSearchFrame) return;
        
        const url = currentLanguageMode === 'japanese' ? 
            `https://www.youdao.com/result?word=${encodeURIComponent(word)}&lang=ja` :
            `https://www.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`;
        this.webSearchFrame.src = url;
    }

    // 标签页切换
    switchTab(tabName) {
        // 更新活动标签
        this.activeTab = tabName;
        
        // 更新按钮状态
        if (this.tabButtons) {
            this.tabButtons.forEach(button => {
                button.classList.toggle('active', button.getAttribute('data-tab') === tabName);
            });
        }
        
        // 更新内容显示
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === tabName);
        });
        
        // 如果切换到网页标签，加载搜索
        if (tabName === 'web-tab' && this.panelSearchInput && this.panelSearchInput.value.trim()) {
            this.loadWebSearch(this.panelSearchInput.value.trim());
        }
    }

    // 工具函数
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    copyWordToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showNotification('已复制到剪贴板: ' + text);
        }).catch(err => {
            console.error('复制失败:', err);
        });
    }

    showNotification(message) {
        // 简单的通知实现
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 10px 15px;
            border-radius: 4px;
            z-index: 10000;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.parentElement.removeChild(notification);
            }
        }, 3000);
    }

    /**
     * 添加当前单词到Anki（完整版本）
     */
    async addCurrentWordToAnki() {
        try {
            console.log('开始添加到Anki流程...');
            
            const word = this.panelSearchInput?.value?.trim();
            const sentence = this.originalSentence?.textContent?.trim();
            
            if (!word) {
                this.showNotification('请先查询一个单词', 'error');
                return;
            }
            
            // 检查Anki设置是否可用
            if (!window.comicReaderApp || !window.comicReaderApp.ankiSettings) {
                console.error('Anki设置未初始化');
                this.showNotification('Anki设置未初始化，请检查侧边栏设置', 'error');
                return;
            }
            
            console.log('Anki设置可用，开始制卡...', { word, sentence });
            
            // 显示加载状态
            const originalHTML = this.panelAnkiBtn.innerHTML;
            this.panelAnkiBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
            this.panelAnkiBtn.disabled = true;
            
            // 获取释义
            const definition = this.getCurrentDefinition();
            console.log('获取到的释义:', definition);
            
            // 获取当前图片数据并处理
            let imageFieldValue = '';
            if (window.comicReaderApp.zipProcessor) {
                const currentImage = window.comicReaderApp.zipProcessor.getCurrentImageData();
                if (currentImage) {
                    console.log('找到当前图片数据，开始处理...');
                    try {
                        const imageHtml = await this.processImageForAnki(currentImage);
                        if (imageHtml) {
                            imageFieldValue = imageHtml;
                            console.log('图片处理成功:', imageHtml);
                        }
                    } catch (imageError) {
                        console.error('图片处理失败，继续添加卡片（不含图片）:', imageError);
                    }
                }
            }
            
            // 准备卡片数据
            const cardData = {
                sentence: sentence || '',
                word: word,
                meaning: definition || '',
                image: imageFieldValue
            };
            
            console.log('准备添加卡片数据:', cardData);
            
            // 添加到Anki
            const result = await window.comicReaderApp.ankiSettings.addCardToAnki(
                cardData.sentence,
                cardData.word,
                cardData.meaning,
                cardData.image
            );
            
            this.showNotification('成功添加到Anki！', 'success');
            console.log('Anki卡片添加成功:', result);
            
        } catch (error) {
            console.error('添加到Anki失败:', error);
            this.showNotification('添加到Anki失败: ' + error.message, 'error');
        } finally {
            // 恢复按钮状态
            if (this.panelAnkiBtn) {
                this.panelAnkiBtn.innerHTML = '<img src="./assets/icons8-anki-24.png" alt="Anki" class="anki-icon"> 添加到Anki';
                this.panelAnkiBtn.disabled = false;
            }
        }
    }

    /**
     * 获取当前释义
     */
    getCurrentDefinition() {
        try {
            const activeTab = document.querySelector('.tab-button.active');
            if (!activeTab) return '';
            
            const activeTabId = activeTab.getAttribute('data-tab');
            console.log('当前激活标签页:', activeTabId);
            
            switch (activeTabId) {
                case 'dictionary-tab':
                    return this.panelDictionaryResult?.textContent || '';
                case 'custom-tab':
                    const customInput = document.getElementById('panel-custom-definition-input');
                    return customInput?.value || '';
                case 'tampermonkey-tab':
                    const tampermonkeyResult = document.getElementById('panel-tampermonkey-result');
                    return tampermonkeyResult?.textContent || '';
                default:
                    return '';
            }
        } catch (error) {
            console.error('获取释义失败:', error);
            return '';
        }
    }

    /**
     * 处理图片数据用于Anki
     */
    async processImageForAnki(imageData) {
        try {
            console.log('处理图片数据:', imageData);
            
            if (!imageData || !imageData.blob) {
                console.warn('没有可用的图片数据');
                return null;
            }

            // 将图片Blob转换为Base64
            const base64Image = await this.blobToBase64(imageData.blob);
            
            // 生成图片文件名
            const imageFileName = this.generateImageFileName();
            
            // 存储图片到Anki媒体库
            const storedName = await this.storeImageToAnki(imageFileName, base64Image);
            
            // 返回Anki媒体引用格式
            return `<img src="${storedName}">`;
            
        } catch (error) {
            console.error('处理图片失败:', error);
            return null;
        }
    }

    /**
     * 将Blob转换为Base64
     */
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 生成图片文件名
     */
    generateImageFileName() {
        const timestamp = new Date().getTime();
        const randomStr = Math.random().toString(36).substring(2, 8);
        return `comic_reader_${timestamp}_${randomStr}.jpg`;
    }

    /**
     * 存储图片到Anki媒体库
     */
    async storeImageToAnki(filename, base64Image) {
        try {
            console.log('存储图片到Anki媒体库:', filename);
            
            if (!window.comicReaderApp || !window.comicReaderApp.ankiSettings) {
                throw new Error('Anki设置未初始化');
            }

            const response = await window.comicReaderApp.ankiSettings.makeAnkiRequest('storeMediaFile', {
                filename: filename,
                data: base64Image.split(',')[1], // 移除data:image/jpeg;base64,前缀
                deleteExisting: true
            });

            if (response.error) {
                throw new Error(response.error);
            }

            const storedName = response.result || filename;
            console.log('图片文件实际存储名:', storedName);
            return storedName;
            
        } catch (error) {
            console.error('存储图片到Anki失败:', error);
            throw error;
        }
    }

    /**
     * 显示通知
     */
    showNotification(message, type = 'info') {
        try {
            // 移除现有的通知
            const existingNotification = document.querySelector('.dictionary-notification');
            if (existingNotification) {
                existingNotification.remove();
            }
            
            const notification = document.createElement('div');
            notification.className = `dictionary-notification dictionary-notification-${type}`;
            notification.textContent = message;
            
            // 添加样式
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 20px;
                border-radius: 6px;
                color: white;
                z-index: 10000;
                font-size: 14px;
                max-width: 300px;
                box-shadow: var(--shadow);
                ${type === 'success' ? 'background: #4CAF50;' : ''}
                ${type === 'error' ? 'background: #f44336;' : ''}
                ${type === 'info' ? 'background: #2196F3;' : ''}
            `;
            
            document.body.appendChild(notification);
            
            // 3秒后自动移除
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.parentElement.removeChild(notification);
                }
            }, 3000);
        } catch (error) {
            console.error('显示通知失败:', error);
        }
    }

}

// Anki设置功能
class AnkiSettings {
    constructor() {
        this.initElements();
        this.initEventListeners();
        this.loadSettings();
        console.log('AnkiSettings初始化完成');
    }

    initElements() {
        console.log('初始化Anki设置元素...');
        
        // 直接获取所有元素
        this.ankiIp = document.getElementById('anki-ip');
        this.ankiPort = document.getElementById('anki-port');
        this.ankiDeck = document.getElementById('anki-deck');
        this.ankiNoteType = document.getElementById('anki-note-type');
        this.sentenceField = document.getElementById('sentence-field');
        this.wordField = document.getElementById('word-field');
        this.meaningField = document.getElementById('meaning-field');
        this.imageField = document.getElementById('image-field');
        this.testConnectionBtn = document.getElementById('test-connection');
        this.saveSettingsBtn = document.getElementById('save-anki-settings');

        // 创建字段选择器
        this.createFieldSelectors();

        // 检查元素是否存在
        this.checkElements();
    }

    /**
     * 创建字段选择器
     */
    createFieldSelectors() {
        // 将句子字段输入框替换为选择器
        if (this.sentenceField && this.sentenceField.tagName === 'INPUT') {
            const select = document.createElement('select');
            select.id = 'sentence-field';
            select.className = this.sentenceField.className;
            select.innerHTML = '<option value="">加载字段...</option>';
            this.sentenceField.parentNode.replaceChild(select, this.sentenceField);
            this.sentenceField = select;
        }

        // 将单词字段输入框替换为选择器
        if (this.wordField && this.wordField.tagName === 'INPUT') {
            const select = document.createElement('select');
            select.id = 'word-field';
            select.className = this.wordField.className;
            select.innerHTML = '<option value="">加载字段...</option>';
            this.wordField.parentNode.replaceChild(select, this.wordField);
            this.wordField = select;
        }

        // 将释义字段输入框替换为选择器
        if (this.meaningField && this.meaningField.tagName === 'INPUT') {
            const select = document.createElement('select');
            select.id = 'meaning-field';
            select.className = this.meaningField.className;
            select.innerHTML = '<option value="">加载字段...</option>';
            this.meaningField.parentNode.replaceChild(select, this.meaningField);
            this.meaningField = select;
        }

        // 将图片字段输入框替换为选择器
        if (this.imageField && this.imageField.tagName === 'INPUT') {
            const select = document.createElement('select');
            select.id = 'image-field';
            select.className = this.imageField.className;
            select.innerHTML = '<option value="">加载字段...</option>';
            this.imageField.parentNode.replaceChild(select, this.imageField);
            this.imageField = select;
        }
    }

    checkElements() {
        const elements = {
            'anki-ip': this.ankiIp,
            'anki-port': this.ankiPort,
            'anki-deck': this.ankiDeck,
            'anki-note-type': this.ankiNoteType,
            'sentence-field': this.sentenceField,
            'word-field': this.wordField,
            'meaning-field': this.meaningField,
            'image-field': this.imageField,
            'test-connection': this.testConnectionBtn,
            'save-anki-settings': this.saveSettingsBtn
        };

        for (const [id, element] of Object.entries(elements)) {
            if (!element) {
                console.error(`未找到元素: #${id}`);
            } else {
                console.log(`找到元素: #${id}`, element.tagName);
            }
        }
    }

    initEventListeners() {
        console.log('初始化Anki事件监听器...');
        
        // 连接测试
        if (this.testConnectionBtn) {
            this.testConnectionBtn.addEventListener('click', () => {
                console.log('点击连接测试按钮');
                this.testConnection();
            });
        } else {
            console.error('连接测试按钮未找到');
        }

        // 保存设置
        if (this.saveSettingsBtn) {
            this.saveSettingsBtn.addEventListener('click', () => {
                console.log('点击保存设置按钮');
                this.saveSettings();
            });
        } else {
            console.error('保存设置按钮未找到');
        }

        // IP或端口变化时重新加载牌组和模板
        if (this.ankiIp && this.ankiPort) {
            this.ankiIp.addEventListener('change', () => {
                this.loadDecksAndModels();
            });
            this.ankiPort.addEventListener('change', () => {
                this.loadDecksAndModels();
            });
        }

        // 模板变化时加载字段
        if (this.ankiNoteType) {
            this.ankiNoteType.addEventListener('change', () => {
                console.log('模板选择变化:', this.ankiNoteType.value);
                if (this.ankiNoteType.value) {
                    this.loadModelFields(this.ankiNoteType.value);
                }
            });
        }
    }

    /**
     * 测试Anki连接并加载牌组和模板
     */
    async testConnection() {
        console.log('开始测试Anki连接...');
        
        const ip = this.ankiIp?.value || '127.0.0.1';
        const port = this.ankiPort?.value || '8765';
        
        if (!ip || !port) {
            this.showMessage('请填写IP地址和端口号', 'error');
            return;
        }

        try {
            this.showMessage('正在测试连接...', 'info');
            this.testConnectionBtn.disabled = true;
            this.testConnectionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>连接中...</span>';
            
            // 测试连接
            const response = await this.makeAnkiRequest('version');
            
            if (response.error) {
                throw new Error(response.error);
            }

            this.showMessage('连接成功！Anki版本: ' + response.result, 'success');
            
            // 连接成功后加载牌组和模板
            await this.loadDecksAndModels();
            
        } catch (error) {
            console.error('Anki连接测试失败:', error);
            this.showMessage('连接失败: ' + error.message, 'error');
        } finally {
            // 恢复按钮状态
            if (this.testConnectionBtn) {
                this.testConnectionBtn.disabled = false;
                this.testConnectionBtn.innerHTML = '<i class="fas fa-plug"></i><span>连接测试</span>';
            }
        }
    }

    /**
     * 加载牌组和模板列表
     */
    async loadDecksAndModels() {
        try {
            console.log('加载牌组和模板列表...');
            
            // 加载牌组列表
            const decksResponse = await this.makeAnkiRequest('deckNames');
            if (!decksResponse.error && Array.isArray(decksResponse.result)) {
                this.updateDeckSelector(decksResponse.result);
                console.log('加载牌组成功:', decksResponse.result.length);
            } else {
                console.error('加载牌组失败:', decksResponse.error);
            }

            // 加载模板列表
            const modelsResponse = await this.makeAnkiRequest('modelNames');
            if (!modelsResponse.error && Array.isArray(modelsResponse.result)) {
                this.updateModelSelector(modelsResponse.result);
                console.log('加载模板成功:', modelsResponse.result.length);
                
                // 如果当前有选中的模板，加载其字段
                if (this.ankiNoteType && this.ankiNoteType.value) {
                    await this.loadModelFields(this.ankiNoteType.value);
                }
            } else {
                console.error('加载模板失败:', modelsResponse.error);
            }

        } catch (error) {
            console.error('加载牌组和模板失败:', error);
        }
    }

    /**
     * 加载模板字段
     */
    async loadModelFields(modelName) {
        if (!modelName) {
            console.log('未选择模板，跳过字段加载');
            return;
        }

        try {
            console.log(`加载模板字段: ${modelName}`);
            
            const fieldsResponse = await this.makeAnkiRequest('modelFieldNames', {
                modelName: modelName
            });

            if (!fieldsResponse.error && Array.isArray(fieldsResponse.result)) {
                this.updateFieldSelectors(fieldsResponse.result);
                console.log('加载字段成功:', fieldsResponse.result);
            } else {
                console.error('加载字段失败:', fieldsResponse.error);
                this.updateFieldSelectors([]);
            }
        } catch (error) {
            console.error('加载模板字段失败:', error);
            this.updateFieldSelectors([]);
        }
    }

    /**
     * 更新牌组选择器
     */
    updateDeckSelector(decks) {
        if (!this.ankiDeck) {
            console.error('牌组选择器未找到');
            return;
        }

        const currentValue = this.ankiDeck.value;
        this.ankiDeck.innerHTML = '';
        
        // 添加默认选项
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = decks.length > 0 ? '选择牌组...' : '无可用牌组';
        this.ankiDeck.appendChild(defaultOption);

        // 添加牌组选项
        decks.forEach(deck => {
            const option = document.createElement('option');
            option.value = deck;
            option.textContent = deck;
            if (deck === currentValue || deck === ankiSettings.deck) {
                option.selected = true;
            }
            this.ankiDeck.appendChild(option);
        });

        console.log('牌组选择器更新完成');
    }

    /**
     * 更新模板选择器
     */
    updateModelSelector(models) {
        if (!this.ankiNoteType) {
            console.error('模板选择器未找到');
            return;
        }

        const currentValue = this.ankiNoteType.value;
        this.ankiNoteType.innerHTML = '';
        
        // 添加默认选项
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = models.length > 0 ? '选择模板...' : '无可用模板';
        this.ankiNoteType.appendChild(defaultOption);

        // 添加模板选项
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === currentValue || model === ankiSettings.noteType) {
                option.selected = true;
            }
            this.ankiNoteType.appendChild(option);
        });

        console.log('模板选择器更新完成');
    }

    /**
     * 更新字段选择器
     */
    updateFieldSelectors(fields) {
        console.log('更新字段选择器:', fields);
        
        // 更新句子字段选择器
        this.updateSingleFieldSelector(this.sentenceField, fields, ankiSettings.sentenceField, '句子');
        
        // 更新单词字段选择器
        this.updateSingleFieldSelector(this.wordField, fields, ankiSettings.wordField, '单词');
        
        // 更新释义字段选择器
        this.updateSingleFieldSelector(this.meaningField, fields, ankiSettings.meaningField, '释义');
        
        // 更新图片字段选择器
        this.updateSingleFieldSelector(this.imageField, fields, ankiSettings.imageField, '图片');

        console.log('字段选择器更新完成');
    }

    /**
     * 更新单个字段选择器
     */
    updateSingleFieldSelector(selector, fields, savedValue, defaultValue) {
        if (!selector) {
            console.error('字段选择器未找到');
            return;
        }

        const currentValue = selector.value;
        selector.innerHTML = '';
        
        // 添加默认选项
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = fields.length > 0 ? `选择${defaultValue}字段...` : '无可用字段';
        selector.appendChild(defaultOption);

        // 添加字段选项
        fields.forEach(field => {
            const option = document.createElement('option');
            option.value = field;
            option.textContent = field;
            
            // 优先使用当前值，然后是保存的值，最后是默认匹配
            if (field === currentValue) {
                option.selected = true;
            } else if (field === savedValue) {
                option.selected = true;
            } else if (!selector.value && this.autoMatchField(field, defaultValue)) {
                option.selected = true;
            }
            
            selector.appendChild(option);
        });

        // 如果没有选中任何选项，选择第一个字段
        if (!selector.value && fields.length > 0) {
            selector.value = fields[0];
        }
    }

    /**
     * 自动匹配字段名称
     */
    autoMatchField(fieldName, fieldType) {
        const fieldNameLower = fieldName.toLowerCase();
        const fieldTypeLower = fieldType.toLowerCase();
        
        // 常见字段名称匹配规则
        const matchRules = {
            '句子': ['sentence', 'text', 'content', '原文', '例句'],
            '单词': ['word', 'vocabulary', 'term', '单词', '词汇'],
            '释义': ['meaning', 'definition', 'explanation', '释义', '解释'],
            '图片': ['image', 'picture', 'photo', '图片', '插图']
        };

        const rules = matchRules[fieldType] || [];
        return rules.some(rule => fieldNameLower.includes(rule));
    }

    /**
     * 向Anki发送请求
     */
    async makeAnkiRequest(action, params = {}) {
        const ip = this.ankiIp?.value || '127.0.0.1';
        const port = this.ankiPort?.value || '8765';

        console.log(`向Anki发送请求: ${action}`, { ip, port, params });

        try {
            const response = await fetch(`http://${ip}:${port}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: action,
                    version: 6,
                    params: params
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status}`);
            }

            const result = await response.json();
            console.log(`Anki响应:`, result);
            return result;
        } catch (error) {
            console.error('Anki请求失败:', error);
            throw error;
        }
    }

    /**
     * 保存Anki设置
     */
    saveSettings() {
        try {
            console.log('保存Anki设置...');
            
            // 更新设置对象
            ankiSettings = {
                ip: this.ankiIp?.value || '127.0.0.1',
                port: this.ankiPort?.value || '8765',
                deck: this.ankiDeck?.value || '',
                noteType: this.ankiNoteType?.value || '',
                sentenceField: this.sentenceField?.value || '',
                wordField: this.wordField?.value || '',
                meaningField: this.meaningField?.value || '',
                imageField: this.imageField?.value || ''
            };

            // 保存到localStorage
            localStorage.setItem('ankiSettings', JSON.stringify(ankiSettings));
            
            this.showMessage('设置保存成功！', 'success');
            console.log('Anki设置已保存:', ankiSettings);
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showMessage('保存失败: ' + error.message, 'error');
        }
    }

    /**
     * 加载Anki设置
     */
    loadSettings() {
        try {
            console.log('加载Anki设置...');
            const savedSettings = localStorage.getItem('ankiSettings');
            if (savedSettings) {
                ankiSettings = JSON.parse(savedSettings);
                
                // 更新界面
                if (this.ankiIp) this.ankiIp.value = ankiSettings.ip;
                if (this.ankiPort) this.ankiPort.value = ankiSettings.port;
                if (this.ankiDeck) this.ankiDeck.value = ankiSettings.deck;
                if (this.ankiNoteType) this.ankiNoteType.value = ankiSettings.noteType;
                if (this.sentenceField) this.sentenceField.value = ankiSettings.sentenceField;
                if (this.wordField) this.wordField.value = ankiSettings.wordField;
                if (this.meaningField) this.meaningField.value = ankiSettings.meaningField;
                if (this.imageField) this.imageField.value = ankiSettings.imageField;
                
                console.log('Anki设置已加载:', ankiSettings);
            }

            // 尝试自动加载牌组和模板
            setTimeout(() => {
                this.loadDecksAndModels();
            }, 500);
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    /**
     * 显示消息
     */
    showMessage(message, type = 'info') {
        // 移除现有的消息
        const existingMessage = document.querySelector('.anki-message');
        if (existingMessage) {
            existingMessage.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `anki-message anki-message-${type}`;
        messageDiv.textContent = message;

        document.body.appendChild(messageDiv);

        // 3秒后自动移除
        setTimeout(() => {
            if (messageDiv.parentElement) {
                messageDiv.parentElement.removeChild(messageDiv);
            }
        }, 3000);
    }

    /**
     * 向Anki添加卡片（支持图片）
     */
    async addCardToAnki(sentence, word, meaning, imageHtml = '') {
        try {
            console.log('开始添加Anki卡片:', { sentence, word, meaning, hasImage: !!imageHtml });
            
            // 获取当前设置
            const deckName = this.ankiDeck?.value || ankiSettings.deck;
            const modelName = this.ankiNoteType?.value || ankiSettings.noteType;
            
            if (!deckName || !modelName) {
                throw new Error('请先选择牌组和笔记类型');
            }
            
            // 构建字段数据
            const fields = {
                [ankiSettings.sentenceField]: sentence,
                [ankiSettings.wordField]: word,
                [ankiSettings.meaningField]: meaning
            };
            
            // 如果有图片，添加到对应的字段
            if (imageHtml && ankiSettings.imageField) {
                fields[ankiSettings.imageField] = imageHtml;
            }
            
            const note = {
                deckName: deckName,
                modelName: modelName,
                fields: fields,
                options: {
                    allowDuplicate: false,
                    duplicateScope: "deck"
                },
                tags: ["漫画阅读器"]
            };

            console.log('准备发送Anki请求:', note);
            
            const response = await this.makeAnkiRequest('addNote', {
                note: note
            });

            if (response.error) {
                throw new Error(response.error);
            }

            console.log('Anki卡片添加成功:', response.result);
            return response.result;
        } catch (error) {
            console.error('添加Anki卡片失败:', error);
            throw error;
        }
    }
}

// 视图控制功能
class ViewController {
    constructor() {
        this.initElements();
        this.initEventListeners();
        this.initDragAndZoom();
        console.log('ViewController初始化完成');
    }

    initElements() {
        // 获取控制按钮元素
        this.viewModeButtons = document.querySelectorAll('[data-mode]');
        this.fitModeButtons = document.querySelectorAll('[data-mode]');
        this.highlightToggleBtn = document.getElementById('toggle-highlight');
        this.overlayToggleBtn = document.getElementById('toggle-overlay');
        this.prevPageBtn = document.getElementById('prev-page');
        this.nextPageBtn = document.getElementById('next-page');
        this.zoomInBtn = document.getElementById('zoom-in');
        this.zoomOutBtn = document.getElementById('zoom-out');
        this.zoomResetBtn = document.getElementById('zoom-reset');
        this.zoomLevelSpan = document.getElementById('zoom-level');
        this.centerViewBtn = document.getElementById('center-view');
        this.sidebarToggleBtn = document.getElementById('sidebar-toggle');
        this.sidebarControls = document.getElementById('sidebar-controls');
        
        // 新增：顶部设置按钮
        this.sidebarToggleHeaderBtn = document.getElementById('sidebar-toggle-header');
        
        // 侧边栏选项
        this.readingModeRadios = document.querySelectorAll('input[name="reading-mode"]');
        this.showPageNumbersCheckbox = document.getElementById('show-page-numbers');
        this.showOcrBoxesCheckbox = document.getElementById('show-ocr-boxes');
        this.autoFitImagesCheckbox = document.getElementById('auto-fit-images');
        
        // 漫画容器
        this.comicViewport = document.getElementById('comic-viewport');
        this.comicContainer = document.getElementById('comic-container');
        
        // 移动端控制按钮
        this.prevMobileBtn = document.getElementById('prev-mobile');
        this.nextMobileBtn = document.getElementById('next-mobile');
    }

    initEventListeners() {
        // 视图模式切换
        document.querySelectorAll('#view-mode-responsive, #view-mode-fixed').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setViewMode(e.currentTarget.dataset.mode);
            });
        });

        // 适配模式切换
        document.querySelectorAll('#fit-mode-width, #fit-mode-height, #fit-mode-both').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setFitMode(e.currentTarget.dataset.mode);
            });
        });

        // 高亮切换
        if (this.highlightToggleBtn) {
            this.highlightToggleBtn.addEventListener('click', () => {
                this.toggleHighlight();
            });
        }

        // 覆盖层切换
        if (this.overlayToggleBtn) {
            this.overlayToggleBtn.addEventListener('click', () => {
                this.toggleOverlay();
            });
        }

        // 页面导航
        if (this.prevPageBtn) {
            this.prevPageBtn.addEventListener('click', () => {
                if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                    window.comicReaderApp.zipProcessor.previousPage();
                }
            });
        }

        if (this.nextPageBtn) {
            this.nextPageBtn.addEventListener('click', () => {
                if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                    window.comicReaderApp.zipProcessor.nextPage();
                }
            });
        }

        // 缩放控制
        if (this.zoomInBtn) {
            this.zoomInBtn.addEventListener('click', () => {
                this.zoomIn();
            });
        }

        if (this.zoomOutBtn) {
            this.zoomOutBtn.addEventListener('click', () => {
                this.zoomOut();
            });
        }

        if (this.zoomResetBtn) {
            this.zoomResetBtn.addEventListener('click', () => {
                this.zoomReset();
            });
        }

        if (this.centerViewBtn) {
            this.centerViewBtn.addEventListener('click', () => {
                this.centerView();
            });
        }

        // 侧边栏切换 - 侧边按钮
        if (this.sidebarToggleBtn) {
            this.sidebarToggleBtn.addEventListener('click', () => {
                this.toggleSidebar();
            });
        }

        // 新增：顶部设置按钮
        if (this.sidebarToggleHeaderBtn) {
            this.sidebarToggleHeaderBtn.addEventListener('click', () => {
                this.toggleSidebar();
            });
        }

        // 侧边栏选项
        if (this.readingModeRadios) {
            this.readingModeRadios.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.setReadingMode(e.target.value);
                });
            });
        }

        if (this.showPageNumbersCheckbox) {
            this.showPageNumbersCheckbox.addEventListener('change', (e) => {
                this.togglePageNumbers(e.target.checked);
            });
        }

        if (this.showOcrBoxesCheckbox) {
            this.showOcrBoxesCheckbox.addEventListener('change', (e) => {
                this.toggleOcrBoxes(e.target.checked);
            });
        }

        if (this.autoFitImagesCheckbox) {
            this.autoFitImagesCheckbox.addEventListener('change', (e) => {
                this.toggleAutoFit(e.target.checked);
            });
        }

        // 移动端控制按钮
        if (this.prevMobileBtn) {
            this.prevMobileBtn.addEventListener('click', () => {
                if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                    window.comicReaderApp.zipProcessor.previousPage();
                }
            });
        }

        if (this.nextMobileBtn) {
            this.nextMobileBtn.addEventListener('click', () => {
                if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                    window.comicReaderApp.zipProcessor.nextPage();
                }
            });
        }

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

        // 边缘点击区域
        this.initEdgeClickAreas();

        // 侧边栏下拉分组功能
        this.initCollapsibleGroups();
    }

    /**
     * 初始化可折叠分组
     */
    initCollapsibleGroups() {
        const groups = document.querySelectorAll('.sidebar-group.collapsible');
        
        groups.forEach(group => {
            const header = group.querySelector('.group-header');
            const content = group.querySelector('.group-content');
            
            if (header && content) {
                header.addEventListener('click', () => {
                    const isActive = group.classList.contains('active');
                    
                    // 关闭所有其他分组
                    groups.forEach(otherGroup => {
                        if (otherGroup !== group) {
                            otherGroup.classList.remove('active');
                            otherGroup.querySelector('.group-content').style.maxHeight = '0';
                        }
                    });
                    
                    // 切换当前分组
                    if (!isActive) {
                        group.classList.add('active');
                        content.style.maxHeight = content.scrollHeight + 'px';
                    } else {
                        group.classList.remove('active');
                        content.style.maxHeight = '0';
                    }
                });
            }
        });
        
        // 默认展开第一个分组
        if (groups.length > 0) {
            const firstGroup = groups[0];
            const firstContent = firstGroup.querySelector('.group-content');
            firstGroup.classList.add('active');
            firstContent.style.maxHeight = firstContent.scrollHeight + 'px';
        }
    }

    /**
     * 初始化拖拽和缩放功能
     */
    initDragAndZoom() {
        if (!this.comicViewport || !this.comicContainer) return;

        // 鼠标拖拽
        this.comicViewport.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // 只响应左键
            
            isPanning = true;
            this.comicViewport.classList.add('dragging');
            startPanX = e.clientX - translateX;
            startPanY = e.clientY - translateY;
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            
            translateX = e.clientX - startPanX;
            translateY = e.clientY - startPanY;
            this.updateTransform();
        });

        document.addEventListener('mouseup', () => {
            isPanning = false;
            this.comicViewport.classList.remove('dragging');
        });

        // 触摸拖拽
        this.comicViewport.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                // 单指触摸 - 拖拽
                isPanning = true;
                this.comicViewport.classList.add('dragging');
                startPanX = e.touches[0].clientX - translateX;
                startPanY = e.touches[0].clientY - translateY;
            } else if (e.touches.length === 2) {
                // 双指触摸 - 缩放
                isPinching = true;
                initialPinchDistance = this.getDistance(e.touches[0], e.touches[1]);
                lastScale = scale;
            }
            e.preventDefault();
        });

        document.addEventListener('touchmove', (e) => {
            if (isPanning && e.touches.length === 1) {
                // 单指拖拽
                translateX = e.touches[0].clientX - startPanX;
                translateY = e.touches[0].clientY - startPanY;
                this.updateTransform();
            } else if (isPinching && e.touches.length === 2) {
                // 双指缩放
                const currentDistance = this.getDistance(e.touches[0], e.touches[1]);
                scale = lastScale * (currentDistance / initialPinchDistance);
                // 限制缩放范围
                scale = Math.max(0.1, Math.min(5, scale));
                this.updateTransform();
            }
            e.preventDefault();
        });

        document.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                isPanning = false;
                isPinching = false;
                this.comicViewport.classList.remove('dragging');
            }
        });

        // 滚轮缩放
        this.comicViewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(0.1, Math.min(5, scale * delta));
            
            // 计算缩放中心
            const rect = this.comicViewport.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // 调整位置以保持鼠标位置不变
            const scaleChange = newScale / scale;
            translateX = mouseX - (mouseX - translateX) * scaleChange;
            translateY = mouseY - (mouseY - translateY) * scaleChange;
            
            scale = newScale;
            this.updateTransform();
        });

        // 设置初始光标
        this.comicViewport.style.cursor = 'grab';
    }

    /**
     * 计算两点间距离
     */
    getDistance(touch1, touch2) {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * 更新变换
     */
    updateTransform() {
        this.comicContainer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }

    /**
     * 设置视图模式
     */
    setViewMode(mode) {
        currentViewMode = mode;
        
        // 更新按钮状态
        document.querySelectorAll('#view-mode-responsive, #view-mode-fixed').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        // 重新调整图片大小
        if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
            setTimeout(() => {
                window.comicReaderApp.zipProcessor.handleResize();
            }, 100);
        }
        
        console.log(`切换到${mode === 'responsive' ? '自适应' : '固定'}模式`);
    }

    /**
     * 设置适配模式
     */
    setFitMode(mode) {
        fitMode = mode;
        
        // 更新按钮状态
        document.querySelectorAll('#fit-mode-width, #fit-mode-height, #fit-mode-both').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        
        // 重新调整图片大小
        if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
            setTimeout(() => {
                window.comicReaderApp.zipProcessor.handleResize();
            }, 100);
        }
        
        console.log(`切换到适配模式: ${mode}`);
    }

    /**
     * 切换高亮显示
     */
    toggleHighlight() {
        highlightEnabled = !highlightEnabled;
        
        // 更新按钮状态
        if (this.highlightToggleBtn) {
            this.highlightToggleBtn.classList.toggle('active', highlightEnabled);
            this.highlightToggleBtn.dataset.active = highlightEnabled;
        }
        
        // 更新文本块高亮状态
        if (window.comicReaderApp && window.comicReaderApp.mokuroParser) {
            window.comicReaderApp.mokuroParser.updateTextBlockHighlights();
        }
        
        console.log(`高亮显示${highlightEnabled ? '开启' : '关闭'}`);
    }

    /**
     * 切换覆盖层显示
     */
    toggleOverlay() {
        const svgOverlayContainer = document.getElementById('svg-overlay-container');
        if (svgOverlayContainer) {
            const isVisible = svgOverlayContainer.style.display !== 'none';
            svgOverlayContainer.style.display = isVisible ? 'none' : 'block';
            
            // 更新按钮状态
            if (this.overlayToggleBtn) {
                this.overlayToggleBtn.classList.toggle('active', !isVisible);
                this.overlayToggleBtn.dataset.active = !isVisible;
            }
            
            console.log(`覆盖层${isVisible ? '隐藏' : '显示'}`);
        }
    }

    /**
     * 初始化边缘点击区域 - 修复移动端触摸问题
     */
    initEdgeClickAreas() {
        const leftEdge = document.getElementById('left-edge');
        const rightEdge = document.getElementById('right-edge');
        
        const handleLeftEdge = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('左边缘触摸');
            if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                window.comicReaderApp.zipProcessor.previousPage();
            }
        };

        const handleRightEdge = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('右边缘触摸');
            if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                window.comicReaderApp.zipProcessor.nextPage();
            }
        };
        
        if (leftEdge) {
            // 移除之前的事件监听器
            leftEdge.replaceWith(leftEdge.cloneNode(true));
            const newLeftEdge = document.getElementById('left-edge');
            
            // 添加触摸事件
            newLeftEdge.addEventListener('touchstart', handleLeftEdge, { passive: false });
            
            // 同时保留鼠标点击支持
            newLeftEdge.addEventListener('click', handleLeftEdge);
        }
        
        if (rightEdge) {
            // 移除之前的事件监听器
            rightEdge.replaceWith(rightEdge.cloneNode(true));
            const newRightEdge = document.getElementById('right-edge');
            
            // 添加触摸事件
            newRightEdge.addEventListener('touchstart', handleRightEdge, { passive: false });
            
            // 同时保留鼠标点击支持
            newRightEdge.addEventListener('click', handleRightEdge);
        }
        
        console.log('边缘点击区域初始化完成');
    }

    /**
     * 放大
     */
    zoomIn() {
        scale = Math.min(scale + 0.1, 5.0);
        this.updateTransform();
    }

    /**
     * 缩小
     */
    zoomOut() {
        scale = Math.max(scale - 0.1, 0.1);
        this.updateTransform();
    }

    /**
     * 重置缩放
     */
    zoomReset() {
        scale = 1.0;
        translateX = 0;
        translateY = 0;
        this.updateTransform();
    }

    /**
     * 居中视图
     */
    centerView() {
        // 居中当前页面
        const activePage = document.querySelector('.page-wrapper.active');
        if (activePage) {
            activePage.classList.add('centered');
            setTimeout(() => {
                activePage.classList.remove('centered');
            }, 300);
        }
        this.zoomReset();
    }

    /**
     * 切换侧边栏
     */
    toggleSidebar() {
        if (this.sidebarControls) {
            const isOpening = !this.sidebarControls.classList.contains('active');
            this.sidebarControls.classList.toggle('active');
            
            // 如果是在移动端打开侧边栏，隐藏移动控制按钮
            if (window.innerWidth <= 768 && this.prevMobileBtn && this.nextMobileBtn) {
                if (isOpening) {
                    this.prevMobileBtn.style.display = 'none';
                    this.nextMobileBtn.style.display = 'none';
                } else {
                    this.prevMobileBtn.style.display = 'flex';
                    this.nextMobileBtn.style.display = 'flex';
                }
            }
            
            console.log(`侧边栏${isOpening ? '打开' : '关闭'}`);
        }
    }

    /**
     * 设置阅读模式
     */
    setReadingMode(mode) {
        console.log(`设置阅读模式: ${mode}`);
        // 这里可以添加阅读模式切换的逻辑
    }

    /**
     * 切换页码显示
     */
    togglePageNumbers(show) {
        const pageIndicator = document.getElementById('page-indicator');
        if (pageIndicator) {
            pageIndicator.style.display = show ? 'block' : 'none';
        }
        console.log(`页码显示${show ? '开启' : '关闭'}`);
    }

    /**
     * 切换OCR框显示
     */
    toggleOcrBoxes(show) {
        const svgOverlayContainer = document.getElementById('svg-overlay-container');
        if (svgOverlayContainer) {
            svgOverlayContainer.style.display = show ? 'block' : 'none';
        }
        console.log(`OCR框显示${show ? '开启' : '关闭'}`);
    }

    /**
     * 切换自动适配
     */
    toggleAutoFit(enable) {
        console.log(`自动适配${enable ? '开启' : '关闭'}`);
        // 这里可以添加自动适配切换的逻辑
    }

    /**
     * 处理键盘快捷键
     */
    handleKeyboardShortcuts(e) {
        // 防止在输入框中触发快捷键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        switch(e.key) {
            case 'ArrowLeft':
                // 上一页
                if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                    window.comicReaderApp.zipProcessor.previousPage();
                }
                e.preventDefault();
                break;
                
            case 'ArrowRight':
                // 下一页
                if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                    window.comicReaderApp.zipProcessor.nextPage();
                }
                e.preventDefault();
                break;
                
            case ' ':
                // 空格翻页
                if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                    window.comicReaderApp.zipProcessor.nextPage();
                }
                e.preventDefault();
                break;
                
            case '+':
            case '=':
                // 放大
                this.zoomIn();
                e.preventDefault();
                break;
                
            case '-':
                // 缩小
                this.zoomOut();
                e.preventDefault();
                break;
                
            case '0':
                // 重置缩放
                this.zoomReset();
                e.preventDefault();
                break;
                
            case 'f':
            case 'F':
                // 全屏切换
                this.toggleFullscreen();
                e.preventDefault();
                break;
                
            case 'r':
            case 'R':
                // 重置视图
                this.zoomReset();
                if (window.comicReaderApp && window.comicReaderApp.zipProcessor) {
                    window.comicReaderApp.zipProcessor.showPage(0);
                }
                e.preventDefault();
                break;
                
            // 新增：侧边栏切换快捷键
            case 's':
            case 'S':
                // 切换侧边栏
                this.toggleSidebar();
                e.preventDefault();
                break;
        }
    }

    /**
     * 切换全屏
     */
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error(`全屏请求失败: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }
}

// ComicReaderApp类 - 主应用文件
class ComicReaderApp {
    constructor() {
        try {
            console.log('正在初始化ComicReaderApp...');
            
            // 检查依赖
            if (typeof JSZip === 'undefined') {
                throw new Error('JSZip库未加载！请确保在之前引入JSZip');
            }
            
            // 初始化处理器 - 确保ankiSettings在其他组件之前初始化
            this.ankiSettings = new AnkiSettings();
            this.zipProcessor = new ZipProcessor();
            this.mokuroParser = new MokuroParser();
            this.viewController = new ViewController();
            this.dictionaryPanel = new DictionaryPanel();
            
            console.log('ComicReaderApp初始化成功');
            this.initializeEventListeners();
        } catch (error) {
            console.error('ComicReaderApp初始化失败:', error);
            this.showError(`应用初始化失败: ${error.message}`);
        }
    }

    showError(message) {
        // 在页面上显示错误信息
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #f44336;
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 10000;
            max-width: 80%;
        `;
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
        
        // 5秒后自动移除
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.parentElement.removeChild(errorDiv);
            }
        }, 5000);
    }

    initializeEventListeners() {
        console.log('初始化事件监听器...');
        
        // ZIP文件上传
        const zipInput = document.getElementById('comic-file');
        if (zipInput) {
            zipInput.addEventListener('change', (e) => {
                this.handleZipUpload(e);
            });
            console.log('ZIP文件输入监听器已添加');
        } else {
            console.error('未找到ZIP文件输入元素');
        }

        // Mokuro文件上传
        const mokuroInput = document.getElementById('mokuro-file');
        if (mokuroInput) {
            mokuroInput.addEventListener('change', (e) => {
                this.handleMokuroUpload(e);
            });
            console.log('Mokuro文件输入监听器已添加');
        } else {
            console.error('未找到Mokuro文件输入元素');
        }
    }

    async handleZipUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            console.log('未选择文件');
            return;
        }

        try {
            console.log('开始上传ZIP文件:', file.name);
            const comicContainer = document.getElementById('comic-container');
            
            if (!comicContainer) {
                throw new Error('未找到漫画容器');
            }

            const images = await this.zipProcessor.processZipFile(file, 
                (processed, total) => {
                    console.log(`处理进度: ${processed}/${total}`);
                }
            );
            
            this.zipProcessor.displayImages(images, comicContainer);
            console.log('ZIP文件处理完成');
        } catch (error) {
            console.error('ZIP文件处理失败:', error);
            this.showError('ZIP文件处理失败: ' + error.message);
        }
    }

    async handleMokuroUpload(event) {
        const file = event.target.files[0];
        if (!file) {
            console.log('未选择文件');
            return;
        }

        try {
            console.log('开始上传Mokuro文件:', file.name);
            const mokuroData = await this.mokuroParser.parseMokuroFile(file);
            console.log('Mokuro文件处理完成');
        } catch (error) {
            console.error('Mokuro文件解析失败:', error);
            this.showError('Mokuro文件解析失败: ' + error.message);
        }
    }

    // 清理资源
    destroy() {
        this.zipProcessor.cleanup();
        this.mokuroParser.cleanup();
        console.log('ComicReaderApp已清理');
    }
}

// ==================== 油猴脚本精确触发接口 ====================
// 只有在油猴标签页点击搜索时才触发查询

// 油猴脚本相关全局变量
let japaneseWords = [];
let currentWord = '';
let currentMediaType = 'comic';
let pendingSearchQuery = ''; // 存储待处理的搜索词

/**
 * 设置单词数据 - 接收油猴脚本返回的查询结果
 */
function setWordData(wordOrHtml) {
    console.log('油猴脚本返回查询结果:', { 
        contentLength: wordOrHtml?.length,
        activeTab: activeTab
    });
    
    const tampermonkeyResult = document.getElementById('panel-tampermonkey-result');
    if (!tampermonkeyResult) {
        console.warn('油猴结果容器未找到');
        return;
    }

    if (!wordOrHtml) {
        console.warn('油猴脚本返回空内容');
        tampermonkeyResult.innerHTML = '<div class="info">词典查询无结果</div>';
        return;
    }

    try {
        tampermonkeyResult.innerHTML = wordOrHtml;
        console.log('油猴内容显示成功');
        
    } catch (err) {
        console.error('显示油猴内容失败:', err);
        tampermonkeyResult.innerHTML = `<div class="error">内容显示错误: ${err.message}</div>`;
    }
}

/**
 * 设置日语分词结果
 */
function setJapaneseSegmentation(words) {
    japaneseWords = words;
    currentWordIndex = 0;
    console.log('油猴脚本: 设置日语分词结果', words);
}

/**
 * 设置网页搜索URL
 */
function setWebSearchUrl(url) {
    console.log('油猴脚本: 设置网页搜索URL', url);
    const webSearchFrame = document.getElementById('web-search-frame');
    if (webSearchFrame && activeTab === 'web-tab') {
        webSearchFrame.src = url;
    }
}

/**
 * 获取当前状态 - 油猴脚本在搜索前调用以获取查询词
 */
function getMediaPlayerState() {
    const panelSearchInput = document.getElementById('panel-search-input');
    const originalSentence = document.getElementById('original-sentence');
    
    const state = {
        currentWord: panelSearchInput?.value || '',
        currentSentence: originalSentence?.textContent || '',
        currentLanguageMode: currentLanguageMode,
        currentMediaType: currentMediaType,
        clipboardEnabled: clipboardEnabled,
        activeTab: activeTab
    };
    
    console.log('油猴脚本获取搜索状态:', state);
    return state;
}

/**
 * 切换剪贴板功能
 */
function toggleClipboardFunction() {
    clipboardEnabled = !clipboardEnabled;
    console.log('剪贴板状态:', clipboardEnabled);
}

/**
 * 打开词典面板
 */
function openFullscreenDictionary() {
    console.log('油猴脚本: 打开词典面板');
    
    const dictionaryPanel = document.getElementById('dictionary-panel');
    const panelOverlay = document.getElementById('panel-overlay');
    
    if (dictionaryPanel && panelOverlay) {
        dictionaryPanel.classList.add('active');
        panelOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        console.log('词典面板已打开');
    } else {
        console.error('词典面板元素未找到');
    }
}

/**
 * 检查是否在油猴标签页中搜索
 */
function isTampermonkeyTabSearch() {
    return activeTab === 'tampermonkey-tab';
}

/**
 * 获取当前搜索词
 */
function getCurrentSearchWord() {
    const panelSearchInput = document.getElementById('panel-search-input');
    return panelSearchInput?.value.trim() || '';
}

// 注册全局接口
window.mediaPlayer = {
    setJapaneseSegmentation: setJapaneseSegmentation,
    setWordData: setWordData,
    setWebSearchUrl: setWebSearchUrl,
    getState: getMediaPlayerState,
    toggleClipboard: toggleClipboardFunction,
    openDictionary: openFullscreenDictionary
};

console.log('油猴脚本精确触发接口已注册');

// 修改搜索按钮事件监听，只在油猴标签页时触发油猴脚本
document.addEventListener('DOMContentLoaded', function() {
    const originalSearchHandler = window.comicReaderApp?.dictionaryPanel?.handleSearch;
    
    // 重写搜索处理逻辑
    if (window.comicReaderApp && window.comicReaderApp.dictionaryPanel) {
        const dictionaryPanel = window.comicReaderApp.dictionaryPanel;
        
        // 保存原始搜索处理函数
        const originalHandleSearch = dictionaryPanel.handleSearch.bind(dictionaryPanel);
        
        // 重写搜索处理
        dictionaryPanel.handleSearch = function() {
            const query = this.panelSearchInput?.value.trim();
            
            if (!query) {
                this.showNotification('请输入要查询的单词');
                return;
            }
            
            console.log('搜索处理:', { query, activeTab });
            
            // 如果在油猴标签页，让油猴脚本处理搜索
            if (activeTab === 'tampermonkey-tab') {
                console.log('在油猴标签页中搜索，触发油猴脚本查询');
                
                // 显示加载状态
                const tampermonkeyResult = document.getElementById('panel-tampermonkey-result');
                if (tampermonkeyResult) {
                    tampermonkeyResult.innerHTML = `
                        <div style="text-align:center; padding:40px; color:#6c757d;">
                            <i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i><br>
                            <h3 style="margin-top:20px;">正在查询多词典...</h3>
                            <p>搜索词: "${query}"</p>
                        </div>
                    `;
                }
                
                // 油猴脚本会通过 getState() 获取搜索词并开始查询
                // 查询完成后会调用 setWordData() 显示结果
                
            } else {
                // 其他标签页使用原始搜索逻辑
                console.log('在其他标签页搜索，使用原始逻辑');
                originalHandleSearch();
            }
        };
        
        console.log('搜索按钮事件监听已重写');
    }
    
    // 监听标签页切换
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            activeTab = tabName;
            console.log('切换到标签页:', tabName);
            
            // 如果切换到油猴标签页且有搜索词，可以显示提示
            if (tabName === 'tampermonkey-tab') {
                const currentWord = getCurrentSearchWord();
                if (currentWord) {
                    console.log('油猴标签页已激活，可以点击搜索进行查询');
                }
            }
        });
    });
});

// 初始化完成提示
setTimeout(() => {
    console.log('油猴脚本接口初始化完成 - 点击搜索时触发模式');
    console.log('使用流程:');
    console.log('1. 切换到油猴标签页');
    console.log('2. 输入搜索词');
    console.log('3. 点击搜索按钮');
    console.log('4. 油猴脚本执行查询并返回结果');
}, 1000);

// 延迟初始化，确保DOM完全加载
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM内容已加载，开始初始化应用...');
    try {
        window.comicReaderApp = new ComicReaderApp();
        console.log('漫画阅读器应用初始化完成', {
            ankiSettings: !!window.comicReaderApp.ankiSettings,
            zipProcessor: !!window.comicReaderApp.zipProcessor,
            dictionaryPanel: !!window.comicReaderApp.dictionaryPanel
        });
    } catch (error) {
        console.error('应用初始化失败:', error);
        const errorMessage = document.createElement('div');
        errorMessage.style.cssText = `
            color: red;
            padding: 20px;
            text-align: center;
            font-size: 16px;
        `;
        errorMessage.innerHTML = `
            <h3>应用初始化失败</h3>
            <p>${error.message}</p>
            <p>请检查浏览器控制台获取详细信息，并刷新页面重试。</p>
        `;
        document.body.appendChild(errorMessage);
    }
});

console.log('漫画阅读器响应式版本加载完成');