import html
import json
import re
import time
from collections import defaultdict
from datetime import datetime

from bs4 import BeautifulSoup
from openai import OpenAI


class BookmarkOrganizer:
    def __init__(self, base_url, api_key, model_name="gpt-4.1-nano", debug=False):
        """
        初始化书签整理器
        
        Args:
            base_url: OpenAI API基础URL
            api_key: OpenAI API密钥
            model_name: 使用的模型名称，默认为"gpt-4.1-nano"
            debug: 是否打印调试信息，默认为False
        """
        self.client = OpenAI(api_key=api_key, base_url=base_url,default_headers={
            "User-Agent": "OpenBI/Python"
        })
        self.model_name = model_name
        self.debug = debug  # 调试模式标志
        self.categories = {}
        self.existing_categories = set()  # 记录已有分类
        self.category_keywords = defaultdict(list)  # 记录每个分类的关键词

    def parse_nested_bookmarks_html(self, html_file_path):
        """
        解析嵌套结构的书签HTML文件（如Chrome书签）
        返回格式: {'一级目录名': {'书签列表': [书签列表], '子文件夹': {'子文件夹名': [书签列表]}}}
        """
        with open(html_file_path, 'r', encoding='utf-8') as file:
            content = file.read()

        soup = BeautifulSoup(content, 'html.parser')
        folder_structure = {}
        
        # 查找所有H3标签（文件夹标题）
        for h3 in soup.find_all('h3'):
            folder_name = h3.get_text(strip=True)
            folder_structure[folder_name] = {
                'bookmarks': [],
                'subfolders': {}
            }
            
            # 查找该文件夹下的所有直接子元素
            next_dl = h3.find_next_sibling('dl')
            if next_dl:
                # 处理直接的书签链接
                for dt in next_dl.find_all('dt'):
                    # 检查是否是书签链接
                    link = dt.find('a')
                    if link:
                        bookmark = {
                            'title': link.get_text(strip=True),
                            'url': link.get('href', ''),
                            'add_date': link.get('add_date', ''),
                            'icon': link.get('icon', ''),
                            'tags': []
                        }
                        
                        if bookmark['url'] and bookmark['title']:
                            if not bookmark['url'].startswith(('magnet:', 'javascript:')):
                                folder_structure[folder_name]['bookmarks'].append(bookmark)
                    
                    # 检查是否是子文件夹
                    sub_h3 = dt.find('h3')
                    if sub_h3:
                        subfolder_name = sub_h3.get_text(strip=True)
                        folder_structure[folder_name]['subfolders'][subfolder_name] = []
                        
                        # 查找子文件夹下的所有链接
                        sub_dl = dt.find('dl')
                        if sub_dl:
                            for sub_link in sub_dl.find_all('a'):
                                sub_bookmark = {
                                    'title': sub_link.get_text(strip=True),
                                    'url': sub_link.get('href', ''),
                                    'add_date': sub_link.get('add_date', ''),
                                    'icon': sub_link.get('icon', ''),
                                    'tags': []
                                }
                                
                                if sub_bookmark['url'] and sub_bookmark['title']:
                                    if not sub_bookmark['url'].startswith(('magnet:', 'javascript:')):
                                        folder_structure[folder_name]['subfolders'][subfolder_name].append(sub_bookmark)
        
        return folder_structure
    
    def flatten_nested_bookmarks(self, folder_structure, target_folder=None):
        """
        将嵌套的书签结构扁平化，以便AI重新分类
        target_folder: 指定只处理特定的一级文件夹
        返回格式: {'一级目录名': [书签列表], ...}
        """
        flattened_folders = {}
        
        for folder_name, folder_data in folder_structure.items():
            # 如果指定了目标文件夹，则只处理该文件夹
            if target_folder and folder_name != target_folder:
                continue
                
            # 收集所有书签（包括直接书签和子文件夹中的书签）
            all_bookmarks = []
            
            # 添加直接书签
            all_bookmarks.extend(folder_data['bookmarks'])
            
            # 添加子文件夹中的书签
            for subfolder_name, subfolder_bookmarks in folder_data['subfolders'].items():
                # 为子文件夹中的书签添加来源信息
                for bookmark in subfolder_bookmarks:
                    # 在标题中添加子文件夹信息，帮助AI更好地分类
                    bookmark['title'] = f"[{subfolder_name}] {bookmark['title']}"
                    all_bookmarks.append(bookmark)
            
            if all_bookmarks:
                flattened_folders[folder_name] = all_bookmarks
        
        return flattened_folders

    def classify_bookmarks_with_ai(self, bookmarks, batch_size=15):
        """
        使用AI对书签进行分类，带有分类记忆功能
        """
        categorized_bookmarks = defaultdict(list)

        # todo 分批处理 len(bookmarks)
        for i in range(0, len(bookmarks), batch_size):
            batch = bookmarks[i:i + batch_size]
            print(f"正在处理第 {i//batch_size + 1} 批书签，共 {len(batch)} 个...")

            categorized_batch = self._process_batch(batch)

            # 合并结果并更新分类记忆
            self._update_categories(categorized_batch, categorized_bookmarks)

            # 避免API限制
            time.sleep(1)

        return dict(categorized_bookmarks)
    
    def classify_folder_bookmarks_with_ai(self, folder_bookmarks, batch_size=15):
        """
        对每个一级目录内的书签进行二级分类
        输入格式: {'一级目录名': [书签列表], ...}
        输出格式: {'一级目录名': {'二级目录名': [书签列表]}, ...}
        """
        result = {}
        
        for folder_name, bookmarks in folder_bookmarks.items():
            print(f"\n正在处理一级目录: {folder_name} (共 {len(bookmarks)} 个书签)")
            
            if not bookmarks:
                continue
                
            # 为每个一级目录创建独立的分类器实例，避免分类混淆
            temp_categories = set()
            temp_category_keywords = defaultdict(list)
            
            # 对该文件夹内的书签进行分类
            categorized_bookmarks = defaultdict(list)
            
            # 分批处理
            for i in range(0, len(bookmarks), batch_size):
                batch = bookmarks[i:i + batch_size]
                print(f"  正在处理第 {i//batch_size + 1} 批书签，共 {len(batch)} 个...")
                
                # 构建分类提示词，针对当前文件夹内容
                prompt = self._build_folder_classification_prompt(batch, folder_name)
                print(f"prompt: {prompt}")
                
                try:
                    response = self.client.chat.completions.create(
                        model=self.model_name,
                        messages=[
                            {
                                "role": "system",
                                "content": self._build_folder_system_prompt(folder_name)
                            },
                            {
                                "role": "user",
                                "content": prompt
                            }
                        ],
                        temperature=0.3,
                        max_tokens=10000
                    )
                    
                    result_text = response.choices[0].message.content.strip()
                    
                    # 如果是调试模式，打印AI的原始响应
                    if self.debug:
                        print(f"\n===== {folder_name} - AI原始响应 =====")
                        print(result_text)
                        print("======================\n")
                    
                    # 尝试解析JSON响应
                    try:
                        categorized_batch = json.loads(result_text)
                        if self.debug:
                            print("✓ JSON解析成功")
                    except json.JSONDecodeError as e:
                        print(f"✗ 无法解析AI响应为JSON: {str(e)}")
                        if self.debug:
                            print(f"响应内容前200字符: {result_text[:200]}...")
                        print("将使用备用分类方法...")
                        categorized_batch = self._fallback_classification(batch)
                    
                    # 合并结果
                    for category, items in categorized_batch.items():
                        categorized_bookmarks[category].extend(items)
                    
                    # 避免API限制
                    time.sleep(1)
                    
                except Exception as e:
                    print(f"  处理文件夹 {folder_name} 时出错: {str(e)}")
                    print("  将使用备用分类方法...")
                    categorized_batch = self._fallback_classification(batch)
                    for category, items in categorized_batch.items():
                        categorized_bookmarks[category].extend(items)
            
            result[folder_name] = dict(categorized_bookmarks)
            
            # 打印该文件夹的分类统计
            print(f"  {folder_name} 分类统计:")
            for category, items in categorized_bookmarks.items():
                print(f"    {category}: {len(items)} 个书签")
        
        return result
    
    def _build_folder_system_prompt(self, folder_name):
        """
        为特定文件夹构建系统提示词
        """
        return f"""你是一个专业的书签整理助手。请对"{folder_name}"文件夹内的书签进行二级分类。
        分类应该清晰、实用，便于用户查找。请返回有效的JSON格式。请按以下JSON格式返回分类结果，不要使用 Markdown 代码块，仅输出原始 JSON 字符串。以 Python 的 json.loads() 可以直接解析的格式返回结果。确保在归类书签时，每一个存入列表的元素都是统一的字典格式："""
    
    def _build_folder_classification_prompt(self, bookmarks, folder_name):
        """
        为特定文件夹构建分类提示词
        """
        bookmark_list = ""
        for i, bookmark in enumerate(bookmarks):
            bookmark_list += f"{i+1}. 标题: {bookmark['title']}\n   网址: {bookmark['url']}\n"

        prompt = f"""请分析以下"{folder_name}"文件夹内的书签，将它们进行二级分类。
分类应该实用且简洁，不必过分细分。其中原书签标题优化为: [分类类别] 简要主题概括 | 标题

书签列表：
{bookmark_list}

请按以下JSON格式返回分类结果，不要使用 Markdown 代码块，仅输出原始 JSON 字符串。以 Python 的 json.loads() 可以直接解析的格式返回结果。确保在归类书签时，每一个存入列表的元素都是统一的字典格式：
{{
    "二级分类1": [
        {{
            "title": "书签标题",
            "url": "书签网址"
        }}
    ],
    "二级分类2": [
        // 更多书签...
    ]
}}

请确保每个书签都被分类，且分类合理。直接返回JSON，不要其他内容。"""

        return prompt

    def _update_categories(self, new_categories, all_categories):
        """
        更新分类记录，合并相似分类
        """
        for category, items in new_categories.items():
            # 查找最相似的已有分类
            best_match = self._find_best_category_match(category)

            if best_match:
                # 合并到已有分类
                all_categories[best_match].extend(items)
                print(f"将分类 '{category}' 合并到现有分类 '{best_match}'")
            else:
                # 新增分类
                all_categories[category].extend(items)
                self.existing_categories.add(category)
                # 提取分类关键词
                self._extract_category_keywords(category, items)
                print(f"新增分类: '{category}' (包含 {len(items)} 个书签)")

    def _find_best_category_match(self, new_category):
        """
        查找与已有分类最相似的分类
        """
        if not self.existing_categories:
            return None

        new_category_lower = new_category.lower()

        # 定义分类映射规则
        category_mapping = {
            # 技术相关
            '技术开发': ['编程', '开发', '技术', '代码', '程序', '软件', '计算机', 'IT'],
            '开发工具': ['工具', 'IDE', '编辑器', '调试', '测试'],
            '技术博客': ['博客', '技术文章', '教程', '学习笔记'],

            # 学习资源
            '学习资源': ['学习', '教程', '课程', '教育', '培训'],
            '在线课程': ['课程', '教学', '学堂', '慕课'],

            # 工作相关
            '工作工具': ['工作', '办公', '效率', '管理', '协作'],
            '项目管理': ['项目', '管理', '任务', '进度'],

            # 娱乐休闲
            '娱乐休闲': ['娱乐', '休闲', '视频', '音乐', '游戏'],
            '视频平台': ['视频', '影视', '直播', 'B站', 'YouTube'],

            # 搜索引擎
            '搜索引擎': ['搜索', '查询', 'Google', '百度'],
            '翻译工具': ['翻译', '词典', '语言'],
        }



        # 检查是否有直接匹配的映射
        for existing_category, keywords in category_mapping.items():
            if existing_category in self.existing_categories:
                for keyword in keywords:
                    if keyword in new_category_lower:
                        return existing_category

        # 基于名称相似性匹配
        best_match = None
        best_score = 0

        for existing_category in self.existing_categories:
            existing_lower = existing_category.lower()

            # 计算相似度分数
            score = self._calculate_similarity(new_category_lower, existing_lower)

            if score > best_score and score > 0.6:  # 相似度阈值
                best_score = score
                best_match = existing_category

        return best_match

    def _calculate_similarity(self, str1, str2):
        """
        计算两个字符串的相似度（简单的Jaccard相似度）
        """
        set1 = set(str1)
        set2 = set(str2)

        intersection = len(set1.intersection(set2))
        union = len(set1.union(set2))

        return intersection / union if union > 0 else 0

    def _extract_category_keywords(self, category, items):
        """
        从分类的书签中提取关键词
        """
        # 简单的关键词提取：从标题中提取常见词汇
        common_words = {'的', '和', '在', '是', '有', '这个', '一个', '一些', '我的', '你的'}

        all_text = ' '.join([item['title'] for item in items])
        words = re.findall(r'[\u4e00-\u9fa5a-zA-Z]+', all_text.lower())

        # 统计词频
        word_freq = defaultdict(int)
        for word in words:
            if len(word) > 1 and word not in common_words:
                word_freq[word] += 1

        # 取前5个高频词作为关键词
        keywords = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)[:5]
        self.category_keywords[category] = [word for word, freq in keywords]

    def test_api_connection(self):
        """
        测试API连接和模型可用性
        """
        print(f"正在测试API连接和模型可用性...")
        print(f"API Base URL: {self.client.base_url}")
        print(f"使用的模型: {self.model_name}")
        
        try:
            # 发送一个简单的测试请求
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": "测试连接，请回复OK"}],
                max_tokens=10
            )
            
            if response and response.choices:
                result = response.choices[0].message.content.strip()
                print(f"API连接成功! 模型响应: {result}")
                return True
            else:
                print("API响应格式异常")
                return False
                
        except Exception as e:
            print(f"API连接测试失败: {str(e)}")
            return False
    
    def check_available_models(self):
        """
        检查API服务支持的模型列表
        """
        print("\n检查API服务支持的模型列表...")
        
        try:
            # 尝试获取模型列表
            models = self.client.models.list()
            
            print("可用的模型列表:")
            for model in models.data:
                print(f"  - {model.id}")
            
            return [model.id for model in models.data]
            
        except Exception as e:
            print(f"获取模型列表失败: {str(e)}")
            print("这可能是因为您的API服务不支持模型列表查询")
            return []
    
    def try_alternative_models(self, alternative_models):
        """
        尝试使用备选模型
        """
        print("\n尝试使用备选模型...")
        
        for model in alternative_models:
            print(f"\n尝试模型: {model}")
            try:
                response = self.client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "测试连接，请回复OK"}],
                    max_tokens=10
                )
                
                if response and response.choices:
                    result = response.choices[0].message.content.strip()
                    print(f"✓ 模型 {model} 可用! 响应: {result}")
                    self.model_name = model  # 更新为可用的模型
                    return True
                    
            except Exception as e:
                print(f"✗ 模型 {model} 不可用: {str(e)}")
                continue
                
        print("\n所有备选模型都不可用")
        return False

    def _process_batch(self, bookmarks):
        """
        处理一批书签，考虑已有分类
        """
        prompt = self._build_classification_prompt(bookmarks)

        try:
            response = self.client.chat.completions.create(
                model=self.model_name,  # 使用实例变量中的模型名称
                messages=[
                    {
                        "role": "system",
                        "content": self._build_system_prompt()
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=2000
            )

            if isinstance(response, str):
                print(f"API返回了字符串而不是对象: {response[:200]}...")
                return self._fallback_classification(bookmarks)

            result = response.choices[0].message.content.strip()
            
            # 如果是调试模式，打印AI的原始响应
            if self.debug:
                print("\n===== AI原始响应 =====")
                print(result)
                print("======================\n")
            
            # 尝试解析JSON响应
            try:
                parsed_result = json.loads(result)
                if self.debug:
                    print("✓ JSON解析成功")
                return parsed_result
            except json.JSONDecodeError as e:
                print(f"✗ 无法解析AI响应为JSON: {str(e)}")
                if self.debug:
                    print(f"响应内容前200字符: {result[:200]}...")
                print("将使用备用分类方法...")
                return self._fallback_classification(bookmarks)
                
        except Exception as e:
            print(f"API调用出错: {str(e)}")
            print(f"使用的模型: {self.model_name}")
            print("将使用备用分类方法...")
            return self._fallback_classification(bookmarks)

    def _build_system_prompt(self):
        """
        构建系统提示词，包含已有分类信息
        """
        base_prompt = """你是一个专业的书签整理助手。请根据书签的内容和用途进行分类。
        分类应该清晰、实用，便于用户查找。请返回有效的JSON格式，不要使用 Markdown 代码块，仅输出原始 JSON 字符串。以 Python 的 json.loads() 可以直接解析的格式返回结果。）确保在归类书签时，每一个存入列表的元素都是统一的字典格式。"""

        if self.existing_categories:
            categories_list = "，".join(sorted(self.existing_categories))
            base_prompt += f"\n\n已有分类：{categories_list}\n请优先使用已有分类，如果都不合适再创建新分类。"

        return base_prompt

    def _build_classification_prompt(self, bookmarks):
        """
        构建分类提示词
        """
        bookmark_list = ""
        for i, bookmark in enumerate(bookmarks):
            bookmark_list += f"{i+1}. 标题: {bookmark['title']}\n   网址: {bookmark['url']}\n"

        prompt = f"""请分析以下书签，将它们分类到合适的类别中。分类应该实用且简洁，不必过分细分。

书签列表：
{bookmark_list}

请按以下JSON格式返回分类结果，不要使用 Markdown 代码块，仅输出原始 JSON 字符串。以 Python 的 json.loads() 可以直接解析的格式返回结果。）确保在归类书签时，每一个存入列表的元素都是统一的字典格式：
{{
    "分类名称1": [
        {{
            "title": "书签标题",
            "url": "书签网址"
        }}
    ],
    "分类名称2": [
        // 更多书签...
    ]
}}

请确保每个书签都被分类，且分类合理。直接返回JSON，不要其他内容。"""

        return prompt

    def _parse_ai_response(self, response_text, original_bookmarks):
        """
        解析AI返回的分类结果
        """
        try:
            cleaned_text = response_text.replace('```json', '').replace('```', '').strip()

            json_match = re.search(r'\{.*\}', cleaned_text, re.DOTALL)
            if json_match:
                json_str = json_match.group()
                categorized_data = json.loads(json_str)

                validated_categories = {}
                for category, items in categorized_data.items():
                    if isinstance(items, list):
                        validated_items = []
                        for item in items:
                            if isinstance(item, dict) and 'title' in item and 'url' in item:
                                original_bookmark = self._find_original_bookmark(
                                    item['title'], item['url'], original_bookmarks
                                )
                                if original_bookmark:
                                    validated_items.append(original_bookmark)

                        if validated_items:
                            validated_categories[category] = validated_items

                return validated_categories
            else:
                print("未找到有效的JSON格式响应")
                return self._fallback_classification(original_bookmarks)

        except json.JSONDecodeError as e:
            print(f"JSON解析错误: {e}")
            return self._fallback_classification(original_bookmarks)

    def _find_original_bookmark(self, title, url, bookmarks):
        """
        根据标题和URL查找原始书签
        """
        for bookmark in bookmarks:
            if (bookmark['title'].strip() == title.strip() or
                    bookmark['url'] == url):
                return bookmark

        for bookmark in bookmarks:
            if (title.strip() in bookmark['title'] or
                    url in bookmark['url']):
                return bookmark
        return None

    def _fallback_classification(self, bookmarks):
        """
        备用分类方案
        """
        categories = {
            "技术开发": [],
            "学习资源": [],
            "工作工具": [],
            "搜索引擎": [],
            "娱乐休闲": [],
            "其他": []
        }

        tech_keywords = ['编程', '代码', '开发', '技术', 'IT', '计算机', '软件', '算法', 'github', 'git']
        learning_keywords = ['教程', '学习', '课程', '教育', '知识', '文档', '博客', 'blog']
        work_keywords = ['工作', '工具', '办公', '管理', '项目', 'redmine', '后台', 'admin']
        search_keywords = ['搜索', 'google', '百度', '查询', '翻译', 'fanyi']
        entertainment_keywords = ['视频', '音乐', '游戏', '娱乐', 'bilibili', 'youtube', '影视']

        for bookmark in bookmarks:
            title_lower = bookmark['title'].lower()
            url_lower = bookmark['url'].lower()

            classified = False

            for keyword in tech_keywords:
                if keyword in title_lower or keyword in url_lower:
                    categories["技术开发"].append(bookmark)
                    classified = True
                    break

            if not classified:
                for keyword in learning_keywords:
                    if keyword in title_lower or keyword in url_lower:
                        categories["学习资源"].append(bookmark)
                        classified = True
                        break

            if not classified:
                for keyword in work_keywords:
                    if keyword in title_lower or keyword in url_lower:
                        categories["工作工具"].append(bookmark)
                        classified = True
                        break

            if not classified:
                for keyword in search_keywords:
                    if keyword in title_lower or keyword in url_lower:
                        categories["搜索引擎"].append(bookmark)
                        classified = True
                        break

            if not classified:
                for keyword in entertainment_keywords:
                    if keyword in title_lower or keyword in url_lower:
                        categories["娱乐休闲"].append(bookmark)
                        classified = True
                        break

            if not classified:
                categories["其他"].append(bookmark)

        return categories

    def generate_two_level_html(self, folder_categorized_bookmarks, output_file):
        """
        生成支持二级目录的HTML书签文件
        输入格式: {'一级目录名': {'二级目录名': [书签列表]}, ...}
        """
        html_template = """<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically organized bookmark file -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Organized Bookmarks (Two Levels)</TITLE>
<H1>Organized Bookmarks (Two Levels)</H1>
<DL><p>
{content}
</DL></p>"""

        # 一级目录模板
        first_level_template = """
    <DT><H3 ADD_DATE="{timestamp}">{folder_name}</H3>
    <DL><p>
{subfolders}
    </DL><p>"""

        # 二级目录模板
        second_level_template = """
        <DT><H3 ADD_DATE="{timestamp}">{subfolder_name}</H3>
        <DL><p>
{bookmarks}
        </DL><p>"""

        bookmark_template = '            <DT><A HREF="{url}" ADD_DATE="{add_date}" ICON="{icon}">{title}</A>'

        content_parts = []
        timestamp = str(int(datetime.now().timestamp()))

        # 按一级目录名称排序
        sorted_folders = sorted(folder_categorized_bookmarks.keys())

        for folder_name in sorted_folders:
            subcategories = folder_categorized_bookmarks[folder_name]
            if subcategories:
                subfolder_parts = []
                
                # 按二级目录名称排序
                sorted_subcategories = sorted(subcategories.keys())
                
                for subcategory in sorted_subcategories:
                    bookmarks = subcategories[subcategory]
                    if bookmarks:
                        bookmark_items = []
                        for bookmark in bookmarks:
                            add_date = bookmark.get('add_date', timestamp)
                            icon = bookmark.get('icon', '')
                            bookmark_items.append(
                                bookmark_template.format(
                                    url=html.escape(bookmark['url']),
                                    add_date=add_date,
                                    icon=icon,
                                    title=html.escape(bookmark['title'])
                                )
                            )

                        subfolder_content = second_level_template.format(
                            timestamp=timestamp,
                            subfolder_name=html.escape(subcategory),
                            bookmarks='\n'.join(bookmark_items)
                        )
                        subfolder_parts.append(subfolder_content)

                # 如果有二级目录，创建一级目录
                if subfolder_parts:
                    folder_content = first_level_template.format(
                        timestamp=timestamp,
                        folder_name=html.escape(folder_name),
                        subfolders='\n'.join(subfolder_parts)
                    )
                    content_parts.append(folder_content)

        final_html = html_template.format(content='\n'.join(content_parts))

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(final_html)

        print(f"整理后的二级目录书签已保存到: {output_file}")
        
        # 统计信息
        total_folders = len(folder_categorized_bookmarks)
        total_subfolders = sum(len(subcats) for subcats in folder_categorized_bookmarks.values())
        total_bookmarks = sum(
            len(bookmarks) 
            for subcats in folder_categorized_bookmarks.values() 
            for bookmarks in subcats.values()
        )
        
        print(f"总共整理了 {total_folders} 个一级目录，{total_subfolders} 个二级目录，{total_bookmarks} 个书签")

    def organize_bookmarks_two_level(self, input_file, output_file, target_folder=None):
        """
        主函数：整理书签为二级目录结构
        target_folder: 指定只整理特定的一级文件夹，None表示整理所有文件夹
        """
        print("开始解析嵌套书签结构...")
        folder_structure = self.parse_nested_bookmarks_html(input_file)
        
        if not folder_structure:
            print("没有找到有效的书签，请检查文件格式")
            return
            
        # 将嵌套结构扁平化，以便AI重新分类
        folder_bookmarks = self.flatten_nested_bookmarks(folder_structure, target_folder)
        
        if not folder_bookmarks:
            if target_folder:
                print(f"错误: 找不到指定的一级文件夹 '{target_folder}'")
                print("可用的一级文件夹:")
                for folder in folder_structure.keys():
                    print(f"  - {folder}")
            else:
                print("没有找到有效的书签，请检查文件格式")
            return
            
        # 打印一级目录统计
        print("\n一级目录统计:")
        total_bookmarks = 0
        for folder, bookmarks in folder_bookmarks.items():
            print(f"  {folder}: {len(bookmarks)} 个书签")
            total_bookmarks += len(bookmarks)
        print(f"总计: {total_bookmarks} 个书签")

        print("\n使用AI对每个一级目录内的书签进行二级分类...")
        folder_categorized_bookmarks = self.classify_folder_bookmarks_with_ai(folder_bookmarks)

        print("\n生成整理后的二级目录书签文件...")
        self.generate_two_level_html(folder_categorized_bookmarks, output_file)


def main():
    """
    主函数 - 使用示例
    """

    base_url = "https://ai.hybgzs.com/v1"

    api_key = "sk-XXX"

    # 设置使用的模型名称 - 可以根据需要修改
    model_name = "hyb-Optimal/gemini-2.5-flash"

    # 调试模式 - 设置为True可以看到AI的原始响应
    debug_mode = True  # 如果不需要查看调试信息，可以设置为False
    
    # 备选模型列表（按优先级排序）
    alternative_models = [

    ]

    # 仅整理指定的一级文件夹
    TARGET_FOLDER = "技术文档"  # 例如: "技术文档" 或 None

    # 输入输出待整理的书签文件路径
    INPUT_FILE = "E:\\bookmarks.html"
    
    # 二级目录输出文件

    OUTPUT_FILE = f"E:\\bookmarks_done_{TARGET_FOLDER}.html"
    

    # 创建整理器实例
    organizer = BookmarkOrganizer(base_url, api_key, model_name, debug_mode)
    
    # 检查API服务支持的模型列表
    available_models = organizer.check_available_models()
    
    # 测试API连接
    if not organizer.test_api_connection():
        print("API连接测试失败，尝试使用备选模型...")
        
        # 尝试使用备选模型
        if not organizer.try_alternative_models(alternative_models):
            print("所有模型都不可用，请检查您的API配置")
            print("可能的解决方案:")
            print("1. 检查API密钥是否正确")
            print("2. 检查base_url是否正确")
            print("3. 确认API服务是否支持您尝试的模型")
            if available_models:
                print("\n根据API返回，以下模型可能可用:")
                for model in available_models[:10]:  # 只显示前10个
                    print(f"  - {model}")
            return
        else:
            print(f"已切换到可用模型: {organizer.model_name}")

    try:
        # 使用二级目录模式整理书签
        print("使用二级目录模式整理书签...")
        if TARGET_FOLDER:
            print(f"仅整理指定的一级文件夹: {TARGET_FOLDER}")
        organizer.organize_bookmarks_two_level(INPUT_FILE, OUTPUT_FILE, TARGET_FOLDER)
        print("\n二级目录书签整理完成！")

    except Exception as e:
        print(f"整理过程中出现错误: {e}")


if __name__ == "__main__":
    main()