// 漫画阅读器 - 合并版JS文件（包含词典功能）

// 确保JSZip可用
if (typeof JSZip === 'undefined') {
    console.error('JSZip库未加载！请确保在之前引入JSZip');
}

// 全局变量
let currentLanguageMode = 'english';
let currentWordIndex = -1;
let appendedWords = [];
let currentOriginalSentence = '';
let currentSentence = '';
let clipboardEnabled = false;
let activeTab = 'dictionary-tab';
let wasPlayingBeforeDict = false;
let playerWasPlaying = false;

// DOM元素引用
let dictionaryPanel, panelOverlay, panelDictionaryResult, panelSearchInput;
let panelSearchBtn, appendWordBtn, originalSentence, webSearchFrame;
let closePanelBtn, tabButtons;

// ZipProcessor类 - 处理漫画ZIP压缩包
class ZipProcessor {
    constructor() {
        this.zip = new JSZip();
        console.log('ZipProcessor初始化完成');
    }

    /**
     * 处理上传的ZIP文件
     * @param {File} file - 用户选择的ZIP文件
     * @param {Function} onProgress - 处理进度回调函数
     * @returns {Promise<Array>} - 解析后的图片数据数组
     */
    async processZipFile(file, onProgress = null) {
        try {
            console.log('开始处理ZIP文件:', file.name);
            
            // 重新创建JSZip实例，避免重复使用的问题
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

            // 按文件名排序，确保页码顺序正确
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
     * @param {string} filename - 文件名
     * @returns {boolean}
     */
    isImageFile(filename) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        return imageExtensions.includes(ext);
    }

    /**
     * 处理单个图片文件
     * @param {JSZip} zip - JSZip实例
     * @param {Object} imageFile - 图片文件对象
     * @returns {Promise<Object>} - 图片数据
     */
    async processImageFile(zip, imageFile) {
        // 获取图片的ArrayBuffer数据
        const arrayBuffer = await imageFile.zipEntry.async('arraybuffer');
        
        // 创建Blob URL用于图片显示
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
     * @param {Array} imageDataArray - 图片数据数组
     * @param {HTMLElement} container - 图片容器元素
     */
    displayImages(imageDataArray, container) {
        if (!container) {
            console.error('图片容器未找到');
            return;
        }

        container.innerHTML = '';
        console.log(`开始显示 ${imageDataArray.length} 张图片`);

        imageDataArray.forEach((imageData, index) => {
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'comic-page';
            imgWrapper.dataset.filename = imageData.filename;
            imgWrapper.dataset.pageIndex = index;

            const img = document.createElement('img');
            img.src = imageData.objectURL;
            img.alt = `漫画页面 ${index + 1} - ${imageData.filename}`;
            img.loading = 'lazy'; // 懒加载提升性能

            // 添加加载错误处理
            img.onerror = () => {
                console.error(`图片加载失败: ${imageData.filename}`);
                img.alt = `图片加载失败: ${imageData.filename}`;
            };

            img.onload = () => {
                console.log(`图片加载成功: ${imageData.filename}`);
            };

            imgWrapper.appendChild(img);
            container.appendChild(imgWrapper);
        });
    }

    /**
     * 清理创建的Object URL，释放内存
     * @param {Array} imageDataArray - 图片数据数组
     */
    cleanup(imageDataArray) {
        if (imageDataArray) {
            imageDataArray.forEach(imageData => {
                if (imageData.objectURL) {
                    URL.revokeObjectURL(imageData.objectURL);
                    console.log('清理图片资源:', imageData.filename);
                }
            });
        }
    }
}

// 在MokuroParser类中添加词典功能支持
class MokuroParser {
    constructor() {
        this.currentMokuroData = null;
        this.textBlocks = new Map(); // 存储文本块数据
        console.log('MokuroParser初始化完成');
    }

    /**
     * 处理文本块点击事件 - 修改为打开词典面板
     */
    handleBlockClick(e, blockData) {
        e.stopPropagation();
        
        // 获取OCR文本内容
        const textContent = blockData.lines.join(' ');
        console.log('OCR文本内容:', textContent);
        
        // 打开词典面板并显示OCR内容
        this.openDictionaryWithOCRText(textContent, blockData);
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
            if (window.tokenizer) {
                dictionaryPanel.showJapaneseWordSegmentation(ocrText);
            } else {
                // 如果没有分词器，直接显示文本
                dictionaryPanel.panelSearchInput.value = ocrText;
                dictionaryPanel.panelDictionaryResult.innerHTML = 
                    '<div class="info">点击句子中的单词进行查询，或使用搜索框手动输入</div>';
            }
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

    // 其他原有方法保持不变...
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
                    this.processTextBlocks(mokuroData);
                    console.log('Mokuro文件解析成功');
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

    createTextLayerForImage(imagePath, imageElement, options = {}) {
        const blocks = this.textBlocks.get(imagePath);
        if (!blocks || !imageElement.parentElement) {
            return null;
        }

        const defaultOptions = {
            showBoundingBox: false, // 默认不显示边界框，更美观
            enableHover: true,
            enableClick: true,
            hoverDisplay: 'tooltip'
        };
        const config = { ...defaultOptions, ...options };

        // 创建文本层容器
        const textLayer = document.createElement('div');
        textLayer.className = 'mokuro-text-layer';
        
        const imgRect = imageElement.getBoundingClientRect();
        const scaleX = imgRect.width / imageElement.naturalWidth;
        const scaleY = imgRect.height / imageElement.naturalHeight;

        textLayer.style.position = 'absolute';
        textLayer.style.top = '0';
        textLayer.style.left = '0';
        textLayer.style.width = '100%';
        textLayer.style.height = '100%';
        textLayer.style.pointerEvents = 'none';

        // 为每个文本块创建元素
        blocks.forEach((block, index) => {
            const blockElement = this.createTextBlockElement(block, scaleX, scaleY, config, index);
            if (blockElement) {
                textLayer.appendChild(blockElement);
            }
        });

        // 将文本层添加到图片容器中
        const container = imageElement.parentElement;
        container.style.position = 'relative';
        container.appendChild(textLayer);

        return textLayer;
    }

    createTextBlockElement(block, scaleX, scaleY, config, index) {
        const [x1, y1, x2, y2] = block.box;
        
        const blockElement = document.createElement('div');
        blockElement.className = 'mokuro-text-block';
        blockElement.dataset.blockIndex = index;
        
        // 设置文本块位置和尺寸
        blockElement.style.position = 'absolute';
        blockElement.style.left = (x1 * scaleX) + 'px';
        blockElement.style.top = (y1 * scaleY) + 'px';
        blockElement.style.width = ((x2 - x1) * scaleX) + 'px';
        blockElement.style.height = ((y2 - y1) * scaleY) + 'px';
        blockElement.style.pointerEvents = 'auto';
        blockElement.style.cursor = 'pointer';

        // 可视化的边界框（调试时可开启）
        if (config.showBoundingBox) {
            blockElement.style.border = '1px solid rgba(255, 0, 0, 0.3)';
            blockElement.style.backgroundColor = 'rgba(255, 255, 0, 0.1)';
        } else {
            // 透明背景，只有悬停时显示
            blockElement.style.backgroundColor = 'transparent';
            blockElement.style.transition = 'background-color 0.2s ease';
        }

        // 存储块数据供交互使用
        blockElement.dataset.blockData = JSON.stringify(block);

        // 添加交互事件
        this.attachBlockEvents(blockElement, block, config);

        return blockElement;
    }

    attachBlockEvents(blockElement, blockData, config) {
        if (config.enableHover) {
            blockElement.addEventListener('mouseenter', (e) => {
                this.handleBlockHover(e, blockData, config);
                // 悬停时显示背景
                e.target.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
            });
            
            blockElement.addEventListener('mouseleave', (e) => {
                this.handleBlockHoverEnd(e, config);
                // 离开时恢复透明
                if (!config.showBoundingBox) {
                    e.target.style.backgroundColor = 'transparent';
                }
            });
        }

        if (config.enableClick) {
            blockElement.addEventListener('click', (e) => {
                this.handleBlockClick(e, blockData);
            });
        }
    }

    handleBlockHover(e, blockData, config) {
        const textContent = blockData.lines.join(' ');
        
        if (config.hoverDisplay === 'tooltip') {
            this.showTooltip(e, textContent, blockData);
        }
    }

    showTooltip(e, text, blockData) {
        this.removeExistingTooltip();
        
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
        
        // 定位工具提示
        const x = e.clientX + 10;
        const y = e.clientY + 10;
        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
        
        e.target.dataset.currentTooltip = 'true';
    }

    handleBlockHoverEnd(e, config) {
        if (config.hoverDisplay === 'tooltip') {
            this.removeExistingTooltip();
        }
    }

    removeExistingTooltip() {
        const existingTooltip = document.querySelector('.mokuro-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    }

    createAllTextLayers(mokuroData, options = {}) {
        if (!mokuroData || !mokuroData.pages) {
            console.warn('没有可用的Mokuro数据');
            return;
        }

        mokuroData.pages.forEach(page => {
            const imageElement = this.findImageElementByPath(page.img_path);
            if (imageElement) {
                this.createTextLayerForImage(page.img_path, imageElement, options);
            }
        });
    }

    findImageElementByPath(imagePath) {
        const images = document.querySelectorAll('.comic-page img');
        for (const img of images) {
            if (img.src.includes(imagePath) || img.alt.includes(imagePath)) {
                return img;
            }
        }
        return null;
    }

    cleanup() {
        this.removeExistingTooltip();
        
        const textLayers = document.querySelectorAll('.mokuro-text-layer');
        textLayers.forEach(layer => layer.remove());
        
        this.textBlocks.clear();
        this.currentMokuroData = null;
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
        // 获取DOM元素
        dictionaryPanel = document.getElementById('dictionary-panel');
        panelOverlay = document.getElementById('panel-overlay');
        panelDictionaryResult = document.getElementById('panel-dictionary-result');
        panelSearchInput = document.getElementById('panel-search-input');
        panelSearchBtn = document.getElementById('panel-search-btn');
        appendWordBtn = document.getElementById('append-word-btn');
        originalSentence = document.getElementById('original-sentence');
        webSearchFrame = document.getElementById('web-search-frame');
        closePanelBtn = document.getElementById('close-panel');
        tabButtons = document.querySelectorAll('.tab-button');
    }

    initEventListeners() {
        // 关闭面板
        closePanelBtn.addEventListener('click', this.closeDictionaryPanel);
        panelOverlay.addEventListener('click', this.closeDictionaryPanel);

        // 搜索功能
        panelSearchBtn.addEventListener('click', this.handleSearch);
        panelSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSearch();
            }
        });

        // 标签页切换
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.getAttribute('data-tab'));
            });
        });

        // 追加词汇
        appendWordBtn.addEventListener('click', this.handleAppendWord);
    }

    // 底部面板功能
    openDictionaryPanel() {
        panelDictionaryResult.style.display = 'block';
        dictionaryPanel.classList.add('active');
        panelOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    // 关闭词典面板
    closeDictionaryPanel() {
        dictionaryPanel.classList.remove('active');
        panelOverlay.classList.remove('active');
        document.body.style.overflow = '';
        
        // 恢复播放状态（全屏模式）
        if (window.isFullscreen && window.wasPlayingBeforeDict) {
            if (window.fullscreenVideoPlayer) {
                window.fullscreenVideoPlayer.play().catch(()=>{});
            }
        }
        // 恢复播放状态（非全屏模式）
        else if (window.playerWasPlaying) {
            if (window.currentMediaType === 'video' && window.videoPlayer && window.videoPlayer.paused) {
                window.videoPlayer.play();
            } else if (window.currentMediaType === 'audio' && window.audioElement && window.audioElement.paused) {
                window.audioElement.play();
                if (window.audioPlayPauseBtn) {
                    window.audioPlayPauseBtn.textContent = '⏸';
                    window.audioPlayPauseBtn.classList.add('active');
                }
            }
        }

        // 重置追加词汇状态
        this.resetAppendedWords();
    }

    // 在面板中查询英语单词
    async searchWordInPanel(word) {
        if (!word.trim()) {
            panelDictionaryResult.innerHTML = '<div class="error">请输入要查询的单词</div>';
            return;
        }
        
        this.openDictionaryPanel();
        panelDictionaryResult.innerHTML = '<div class="loading">查询中...若无显示,请手动点击搜索按键</div>';
        panelSearchInput.value = word;
        
        if (activeTab === 'web-tab') {
            this.loadWebSearch(word);
        }
        // dictionary-tab 时自动查询
        else if (activeTab === 'dictionary-tab')  {
            try {
                const apiUrl = `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(word)}`;
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
                panelDictionaryResult.innerHTML = `<div class="error">${error.message}</div>`;
                console.error('查询错误:', error);
            }
        }
    }

    // 显示生成结构化英语单词数据html页面转给底部面板显示
    displayWordDataInPanel(wordData) {
        if (!wordData.word || !Array.isArray(wordData.entries)) {
            panelDictionaryResult.innerHTML = '<div class="error">返回的数据格式不正确</div>';
            return;
        }
        
        let html = `
            <div class="word-header">
                <div class="word-title">${this.escapeHtml(wordData.word)}</div>
            </div>
        `;
        
        wordData.entries.forEach((entry, entryIndex) => {
            html += `<div class="entry">`;
            
            if (entry.partOfSpeech) {
                html += `<div class="part-of-speech">${this.escapeHtml(entry.partOfSpeech)}</div>`;
            }
            
            if (Array.isArray(entry.pronunciations) && entry.pronunciations.length > 0) {
                const filteredPronunciations = entry.pronunciations.filter(p => 
                    p.tags && p.tags.some(tag => tag === "US" || tag === "UK")
                ).slice(0, 2);
                
                if (filteredPronunciations.length > 0) {
                    html += `<div class="initial-pronunciations">`;
                    filteredPronunciations.forEach(pronunciation => {
                        const type = pronunciation.type ? ` (${pronunciation.type})` : '';
                        const tags = pronunciation.tags && pronunciation.tags.length > 0 ? 
                            ` <small>${pronunciation.tags.join(', ')}</small>` : '';
                        html += `<div class="pronunciation">/${this.escapeHtml(pronunciation.text)}/${type}${tags}</div>`;
                    });
                    html += `</div>`;
                    
                    if (entry.pronunciations.length > filteredPronunciations.length) {
                        const allPronunciationsId = `all-pronunciations-${entryIndex}`;
                        html += `<button class="toggle-button" 
                                  onclick="toggleSection('${allPronunciationsId}', this, '显示全部发音 (${entry.pronunciations.length})', '隐藏全部发音')">显示全部发音 (${entry.pronunciations.length})</button>`;
                        html += `<div id="${allPronunciationsId}" class="collapsible-section" style="display: none;">`;
                        entry.pronunciations.forEach(pronunciation => {
                            const type = pronunciation.type ? ` (${pronunciation.type})` : '';
                            const tags = pronunciation.tags && pronunciation.tags.length > 0 ? 
                                ` <small>${pronunciation.tags.join(', ')}</small>` : '';
                            html += `<div class="pronunciation">/${this.escapeHtml(pronunciation.text)}/${type}${tags}</div>`;
                        });
                        html += `</div>`;
                    }
                }
            }
            
            if (Array.isArray(entry.senses)) {
                let senseCounter = 0;
                
                const renderSenses = (senses, level = 0, sensePath = '') => {
                    let sensesHtml = '';
                    senses.forEach((sense, index) => {
                        senseCounter++;
                        const currentSensePath = sensePath ? `${sensePath}-${index}` : `${entryIndex}-${index}`;
                        
                        sensesHtml += `<div class="sense" style="margin-left: ${level * 15}px;">`;
                        
                        if (sense.definition) {
                            const number = level === 0 ? `${senseCounter}.` : `${senseCounter}`;
                            sensesHtml += `<div class="definition"><strong>${number}</strong> ${this.escapeHtml(sense.definition)}</div>`;
                        }
                        
                        if (Array.isArray(sense.tags) && sense.tags.length > 0) {
                            sensesHtml += `<div style="font-size: 12px; color: #586069; margin-bottom: 5px;">标签: ${sense.tags.map(t => this.escapeHtml(t)).join(', ')}</div>`;
                        }
                        
                        if (Array.isArray(sense.examples) && sense.examples.length > 0) {
                            const maxInitialExamples = 2;
                            const initialExamples = sense.examples.slice(0, maxInitialExamples);
                            const remainingExamples = sense.examples.slice(maxInitialExamples);
                            
                            initialExamples.forEach(example => {
                                sensesHtml += `<div class="example">${this.escapeHtml(example)}</div>`;
                            });
                            
                            if (remainingExamples.length > 0) {
                                const allExamplesId = `all-examples-${currentSensePath}`;
                                sensesHtml += `<button class="toggle-button examples-toggle" 
                                          onclick="toggleSection('${allExamplesId}', this, '显示更多例句 (${sense.examples.length})', '隐藏更多例句')">显示更多例句 (${sense.examples.length})</button>`;
                                sensesHtml += `<div id="${allExamplesId}" class="collapsible-section" style="display: none;">`;
                                remainingExamples.forEach(example => {
                                    sensesHtml += `<div class="example">${this.escapeHtml(example)}</div>`;
                                });
                                sensesHtml += `</div>`;
                            }
                        }
                        
                        if (Array.isArray(sense.quotes)) {
                            sense.quotes.forEach(quote => {
                                sensesHtml += `<div class="quote">"${this.escapeHtml(quote.text)}"`;
                                if (quote.reference) {
                                    sensesHtml += `<div class="quote-reference">— ${this.escapeHtml(quote.reference)}</div>`;
                                }
                                sensesHtml += `</div>`;
                            });
                        }
                        
                        if (Array.isArray(sense.synonyms) && sense.synonyms.length > 0) {
                            sensesHtml += `<div class="synonyms"><span>同义词:</span> ${sense.synonyms.map(s => this.escapeHtml(s)).join(', ')}</div>`;
                        }
                        if (Array.isArray(sense.antonyms) && sense.antonyms.length > 0) {
                            sensesHtml += `<div class="antonyms"><span>反义词:</span> ${sense.antonyms.map(a => this.escapeHtml(a)).join(', ')}</div>`;
                        }
                        
                        if (Array.isArray(sense.subsenses) && sense.subsenses.length > 0) {
                            sensesHtml += renderSenses(sense.subsenses, level + 1, currentSensePath);
                        }
                        
                        sensesHtml += `</div>`;
                    });
                    return sensesHtml;
                };
                
                html += renderSenses(entry.senses);
            }
            
            if (Array.isArray(entry.forms) && entry.forms.length > 0) {
                const maxInitialForms = 2;
                const initialForms = entry.forms.slice(0, maxInitialForms);
                const remainingForms = entry.forms.slice(maxInitialForms);
                
                html += `<div class="initial-forms" style="margin-top: 15px;"><small><strong>词形变化:</strong> `;
                const initialFormsHtml = initialForms.map(form => 
                    `${this.escapeHtml(form.word)}${form.tags && form.tags.length > 0 ? ` (${form.tags.join(', ')})` : ''}`
                ).join(', ');
                html += initialFormsHtml;
                html += `</small></div>`;
                
                if (remainingForms.length > 0) {
                    const allFormsId = `all-forms-${entryIndex}`;
                    html += `<button class="toggle-button" 
                              onclick="toggleSection('${allFormsId}', this, '显示全部词形变化 (${entry.forms.length})', '隐藏全部词形变化')">显示全部词形变化 (${entry.forms.length})</button>`;
                    html += `<div id="${allFormsId}" class="collapsible-section" style="display: none;">`;
                    const allFormsHtml = entry.forms.map(form => 
                        `${this.escapeHtml(form.word)}${form.tags && form.tags.length > 0 ? ` (${form.tags.join(', ')})` : ''}`
                    ).join(', ');
                    html += allFormsHtml;
                    html += `</div>`;
                }
            }
            
            if (Array.isArray(entry.synonyms) && entry.synonyms.length > 0) {
                html += `<div class="synonyms"><span>同义词:</span> ${entry.synonyms.map(s => this.escapeHtml(s)).join(', ')}</div>`;
            }
            if (Array.isArray(entry.antonyms) && entry.antonyms.length > 0) {
                html += `<div class="antonyms"><span>反义词:</span> ${entry.antonyms.map(a => this.escapeHtml(a)).join(', ')}</div>`;
            }
            
            html += `</div>`;
        });
        
        panelDictionaryResult.innerHTML = html;
    }

    // 查询日语单词
    async searchJapaneseWordInPanel(word) {
        if (!word.trim()) {
            panelDictionaryResult.innerHTML = '<div class="error">请输入要查询的单词</div>';
            return;
        }
        
        this.openDictionaryPanel();
        panelDictionaryResult.innerHTML = '<div class="loading">查询中...若无显示,请手动点击搜索按键</div>';
        panelSearchInput.value = word;
        
        if (activeTab === 'web-tab') {
            this.loadWebSearch(word);
        }
        // dictionary-tab 时自动查询
        else if (activeTab === 'dictionary-tab')  {
            try {
                const apiUrl = `https://freedictionaryapi.com/api/v1/entries/ja/${encodeURIComponent(word)}`;
                const response = await fetch(apiUrl);
                
                if (!response.ok) {
                    if (response.status === 404) {
                        throw new Error(`未找到日语单词 "${word}"`);
                    } else {
                        throw new Error(`API请求失败: ${response.status}`);
                    }
                }
                
                const data = await response.json();
                this.displayJapaneseWordDataInPanel(data);
            } catch (error) {
                panelDictionaryResult.innerHTML = `<div class="error">${error.message}</div>`;
                console.error('查询错误:', error);
            }
        }
    }

    // 显示生成结构化日语单词数据html页面转给底部面板显示
    displayJapaneseWordDataInPanel(wordData) {
        if (!wordData.word || !Array.isArray(wordData.entries)) {
            panelDictionaryResult.innerHTML = '<div class="error">返回的数据格式不正确</div>';
            return;
        }

        let html = `
            <div class="word-header">
                <div class="word-title">${this.escapeHtml(wordData.word)}</div>
            </div>
        `;

        wordData.entries.forEach((entry, entryIndex) => {
            html += `<div class="entry">`;

            if (entry.partOfSpeech) {
                html += `<div class="part-of-speech">${this.escapeHtml(entry.partOfSpeech)}</div>`;
            }

            // 发音处理
            if (Array.isArray(entry.pronunciations) && entry.pronunciations.length > 0) {
                const filteredPronunciations = entry.pronunciations.slice(0, 2);
                if (filteredPronunciations.length > 0) {
                    html += `<div class="initial-pronunciations">`;
                    filteredPronunciations.forEach(pronunciation => {
                        const type = pronunciation.type ? ` (${pronunciation.type})` : '';
                        html += `<div class="pronunciation">/${this.escapeHtml(pronunciation.text)}/${type}</div>`;
                    });
                    html += `</div>`;

                    if (entry.pronunciations.length > filteredPronunciations.length) {
                        const allPronunciationsId = `all-pronunciations-${entryIndex}`;
                        html += `<button class="toggle-button" 
                                  onclick="toggleSection('${allPronunciationsId}', this, '显示全部发音 (${entry.pronunciations.length})', '隐藏全部发音')">显示全部发音 (${entry.pronunciations.length})</button>`;
                        html += `<div id="${allPronunciationsId}" class="collapsible-section" style="display: none;">`;
                        entry.pronunciations.forEach(pronunciation => {
                            const type = pronunciation.type ? ` (${pronunciation.type})` : '';
                            html += `<div class="pronunciation">/${this.escapeHtml(pronunciation.text)}/${type}</div>`;
                        });
                        html += `</div>`;
                    }
                }
            }

            // 释义/例句/同义词/反义词
            if (Array.isArray(entry.senses)) {
                let senseCounter = 0;

                const renderSenses = (senses, level = 0, sensePath = '') => {
                    let sensesHtml = '';
                    senses.forEach((sense, index) => {
                        senseCounter++;
                        const currentSensePath = sensePath ? `${sensePath}-${index}` : `${entryIndex}-${index}`;
                        sensesHtml += `<div class="sense" style="margin-left: ${level * 15}px;">`;

                        if (sense.definition) {
                            const number = level === 0 ? `${senseCounter}.` : `${senseCounter}`;
                            sensesHtml += `<div class="definition"><strong>${number}</strong> ${this.escapeHtml(sense.definition)}</div>`;
                        }

                        if (Array.isArray(sense.examples) && sense.examples.length > 0) {
                            const maxInitialExamples = 2;
                            const initialExamples = sense.examples.slice(0, maxInitialExamples);
                            const remainingExamples = sense.examples.slice(maxInitialExamples);

                            initialExamples.forEach(example => {
                                sensesHtml += `<div class="example">${this.escapeHtml(example)}</div>`;
                            });

                            if (remainingExamples.length > 0) {
                                const allExamplesId = `all-examples-${currentSensePath}`;
                                sensesHtml += `<button class="toggle-button examples-toggle" 
                                          onclick="toggleSection('${allExamplesId}', this, '显示更多例句 (${sense.examples.length})', '隐藏更多例句')">显示更多例句 (${sense.examples.length})</button>`;
                                sensesHtml += `<div id="${allExamplesId}" class="collapsible-section" style="display: none;">`;
                                remainingExamples.forEach(example => {
                                    sensesHtml += `<div class="example">${this.escapeHtml(example)}</div>`;
                                });
                                sensesHtml += `</div>`;
                            }
                        }

                        if (Array.isArray(sense.subsenses) && sense.subsenses.length > 0) {
                            sensesHtml += renderSenses(sense.subsenses, level + 1, currentSensePath);
                        }

                        sensesHtml += `</div>`;
                    });
                    return sensesHtml;
                };

                html += renderSenses(entry.senses);
            }

            html += `</div>`; // entry 结束
        });

        panelDictionaryResult.innerHTML = html;
    }

    // 日语分词显示
    async showJapaneseWordSegmentation(sentence, currentWord = '') {
        if (!window.tokenizer) {
            console.error('分词器未初始化');
            return [];
        }

        try {
            const result = window.tokenizer.tokenize(sentence);
            const japaneseWords = result.map(item => item.surface_form);

            this.openDictionaryPanel();
            panelDictionaryResult.innerHTML = '';

            let clickableSentence = '';
            let lastIndex = 0;

            result.forEach((item, index) => {
                if (item.word_position > lastIndex) clickableSentence += sentence.substring(lastIndex, item.word_position);

                clickableSentence += `<span class="sentence-word selectable-word" data-word="${item.surface_form}" data-index="${index}">${item.surface_form}</span>`;

                lastIndex = item.word_position + item.surface_form.length;
            });

            if (lastIndex < sentence.length) clickableSentence += sentence.substring(lastIndex);

            originalSentence.innerHTML = clickableSentence;
            currentOriginalSentence = sentence;

            originalSentence.removeEventListener('click', this.handleSentenceWordClick);
            originalSentence.addEventListener('click', this.handleSentenceWordClick);

            currentSentence = sentence;
            currentWordIndex = currentWord ? japaneseWords.indexOf(currentWord) : -1;
            appendedWords = currentWord ? [currentWord] : [];
            panelSearchInput.value = currentWord || '';

            if (window.japaneseSegmentationComplete) window.japaneseSegmentationComplete(sentence, japaneseWords);

            return japaneseWords; // 返回分词数组，避免重复 tokenize
        } catch (error) {
            console.error('日语分词失败:', error);
            panelDictionaryResult.innerHTML = `<div class="error">日语分词失败: ${error.message}</div>`;
            return [];
        }
    }

    // 更新原句显示
    updateOriginalSentence(sentence, currentWord, currentLanguageMode = 'english', japaneseWords = []) {
        if (currentLanguageMode === 'japanese') {
            let clickableSentence = '';
            if (japaneseWords && japaneseWords.length > 0) {
                let lastIndex = 0;
                let currentPos = 0;
                
                japaneseWords.forEach((word, index) => {
                    const wordPosition = sentence.indexOf(word, currentPos);
                    if (wordPosition === -1) return;
                    
                    if (wordPosition > currentPos) clickableSentence += sentence.substring(currentPos, wordPosition);
                    
                    const isCurrentWord = currentWord && word === currentWord;
                    const wordClass = isCurrentWord ? 'sentence-word highlight selectable-word' : 'sentence-word selectable-word';
                    clickableSentence += `<span class="${wordClass}" data-word="${word}" data-index="${index}">${word}</span>`;
                    
                    currentPos = wordPosition + word.length;
                });
                if (currentPos < sentence.length) clickableSentence += sentence.substring(currentPos);
            } else {
                clickableSentence = `<span>${sentence}</span>`;
            }

            originalSentence.innerHTML = clickableSentence;
            currentOriginalSentence = sentence;
            originalSentence.removeEventListener('click', this.handleSentenceWordClick);
            originalSentence.addEventListener('click', this.handleSentenceWordClick);
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

            originalSentence.innerHTML = clickableSentence;
            currentOriginalSentence = sentence;

            // 重新绑定点击事件
            originalSentence.removeEventListener('click', this.handleSentenceWordClick);
            originalSentence.addEventListener('click', this.handleSentenceWordClick);

            console.log('英语原句更新完成:', { 
                sentence, 
                currentWord, 
                currentWordIndex,
                appendedWords 
            });
        }
    }

    // 处理字幕进行的单词点击
    handleSentenceWordClick(e) {
        const span = e.target.closest('.sentence-word');
        if (!span) return;

        const word = span.getAttribute('data-word');
        const index = parseInt(span.getAttribute('data-index'));

        // console.log('点击原句日语分词:', word, '索引:', index);

        // 剪贴板功能
        if (clipboardEnabled) {
            this.copyWordToClipboard(word);
        }

        // 移除其他高亮
        originalSentence.querySelectorAll('.sentence-word').forEach(s => {
            s.classList.remove('highlight');
        });

        // 高亮当前点击的单词
        span.classList.add('highlight');

        // 重置状态并设置新的点击单词
        appendedWords = [word];
        currentWordIndex = index;
        panelSearchInput.value = word;

        // 执行搜索
        if (currentLanguageMode === 'english') {
            this.searchWordInPanel(word);
        } else {
            this.searchJapaneseWordInPanel(word);
        }
    }

    // 重置追加词汇和搜索栏
    resetAppendedWords() {
        currentWordIndex = -1;
        appendedWords = [];
        panelSearchInput.value = '';
        
        originalSentence.querySelectorAll('.sentence-word').forEach(span => {
            span.classList.remove('highlight');
        });
    }

    // 追加词汇功能
    handleAppendWord() {
        const sentenceSpans = originalSentence.querySelectorAll('.sentence-word');
        if (!sentenceSpans.length) {
            console.log('没有可用的句子单词');
            return;
        }

        // console.log('追加前状态 - 索引:', currentWordIndex, '追加词汇:', appendedWords, '句子长度:', sentenceSpans.length);

        // 如果没有有效的当前索引，从第一个单词开始
        if (currentWordIndex === -1) {
            currentWordIndex = 0;
            console.log('重置索引为0');
        } 

        // 如果已经是最后一个单词，不再追加
        else if (currentWordIndex >= sentenceSpans.length - 1) {
            console.log('已经是最后一个单词，无法继续追加');
            return;
        }
        // 否则移动到下一个单词
        else {
            currentWordIndex++;
            console.log('移动到下一个索引:', currentWordIndex);
        }

        const currentSpan = sentenceSpans[currentWordIndex];
        const word = currentSpan.getAttribute('data-word');

        // console.log('追加单词:', word, '位置:', currentWordIndex);
        

        // 更新搜索输入框
        if (currentLanguageMode === 'english' && appendedWords.length > 0) {
            panelSearchInput.value += ' ' + word;
        } else {
            panelSearchInput.value += word;
        }

        // 剪贴板功能
        if (clipboardEnabled) {
            this.copyWordToClipboard(panelSearchInput.value);
        }
        
        appendedWords.push(word);

        // 更新高亮显示 - 高亮所有已追加的单词
        sentenceSpans.forEach((span, idx) => {
            const spanWord = span.getAttribute('data-word');
            const isAppended = appendedWords.includes(spanWord);
            span.classList.toggle('highlight', isAppended && idx <= currentWordIndex);
        });

        // 执行搜索
        if (currentLanguageMode === 'english') {
            this.searchWordInPanel(panelSearchInput.value);
        } else {
            this.searchJapaneseWordInPanel(panelSearchInput.value);
        }
    }

    // 搜索处理
    handleSearch() {
        const word = panelSearchInput.value.trim();
        if (!word) {
            this.showNotification('请输入要查询的单词');
            return;
        }
        
        if (currentLanguageMode === 'english') {
            this.searchWordInPanel(word);
        } else {
            this.searchJapaneseWordInPanel(word);
        }
    }

    // 加载网页查询
    loadWebSearch(word) {
        if (!word) return;
        
        if (window.webSearch) {
            window.webSearch(word);
        } else {
            const url = currentLanguageMode === 'japanese' ? 
                `https://www.youdao.com/result?word=${encodeURIComponent(word)}&lang=ja` :
                `https://www.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`;
            webSearchFrame.src = url;
        }
    }

    // 标签页切换
    switchTab(tabName) {
        // 更新活动标签
        activeTab = tabName;
        
        // 更新按钮状态
        tabButtons.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-tab') === tabName);
        });
        
        // 更新内容显示
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === tabName);
        });
        
        // 如果切换到网页标签，加载搜索
        if (tabName === 'web-tab' && panelSearchInput.value.trim()) {
            this.loadWebSearch(panelSearchInput.value.trim());
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
}

// 添加这个全局函数让嵌入词典框里的释义收缩内容点击后能够正常展开和收起
function toggleSection(sectionId, button, showText, hideText) {
    const section = document.getElementById(sectionId);
    if (section) {
        if (section.style.display === 'none') {
            section.style.display = 'block';
            button.textContent = hideText;
        } else {
            section.style.display = 'none';
            button.textContent = showText;
        }
    }
}

// 添加全局检查，确保依赖已加载
function checkDependencies() {
    if (typeof ZipProcessor === 'undefined') {
        throw new Error('ZipProcessor未定义！请检查zip.js是否已正确加载');
    }
    if (typeof MokuroParser === 'undefined') {
        throw new Error('MokuroParser未定义！请检查mokuro.js是否已正确加载');
    }
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip未定义！请检查JSZip库是否已正确加载');
    }
    return true;
}

// ComicReaderApp类 - 主应用文件
class ComicReaderApp {
    constructor() {
        try {
            console.log('正在初始化ComicReaderApp...');
            
            // 检查依赖
            checkDependencies();
            
            // 初始化处理器
            this.zipProcessor = new ZipProcessor();
            this.mokuroParser = new MokuroParser();
            this.dictionaryPanel = new DictionaryPanel();
            this.currentImages = [];
            
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
            const comicViewer = document.getElementById('comic-viewer');
            
            if (!comicViewer) {
                throw new Error('未找到漫画查看器容器');
            }

            this.currentImages = await this.zipProcessor.processZipFile(file, 
                (processed, total) => {
                    console.log(`处理进度: ${processed}/${total}`);
                }
            );
            
            this.zipProcessor.displayImages(this.currentImages, comicViewer);
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
            this.mokuroParser.createAllTextLayers(mokuroData, {
                showBoundingBox: true, // 调试时可设为true
                enableHover: true,
                enableClick: true,
                hoverDisplay: 'tooltip'
            });
            
            console.log('Mokuro文件解析成功', mokuroData);
        } catch (error) {
            console.error('Mokuro文件解析失败:', error);
            this.showError('Mokuro文件解析失败: ' + error.message);
        }
    }

    // 清理资源
    destroy() {
        this.zipProcessor.cleanup(this.currentImages);
        this.mokuroParser.cleanup();
        console.log('ComicReaderApp已清理');
    }
}

// 延迟初始化，确保DOM完全加载
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM内容已加载，开始初始化应用...');
    try {
        window.comicReaderApp = new ComicReaderApp();
        console.log('漫画阅读器应用初始化完成');
    } catch (error) {
        console.error('应用初始化失败:', error);
        // 显示错误信息给用户
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

console.log('漫画阅读器JS文件合并完成（包含词典功能）');