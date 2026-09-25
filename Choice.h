#ifndef CHOICE_H
#define CHOICE_H

#include <functional>
#include <string>

class GameState;

// 游戏选择：选项文本 + 跳转目标场景 + 可选的条件 / 效果
class Choice {
public:
    Choice(const std::string& text, const std::string& nextSceneId);

    const std::string& text() const { return text_; }
    const std::string& nextSceneId() const { return nextSceneId_; }

    // 条件：返回 true 表示该选项可选；未设置则默认可选
    void setCondition(std::function<bool(const GameState&)> condition);
    // 效果：选中该选项后对游戏状态做的修改
    void setEffect(std::function<void(GameState&)> effect);

    bool isAvailable(const GameState& state) const;
    void applyEffect(GameState& state) const;

private:
    std::string nextSceneId_;
    std::string text_;
    std::function<bool(const GameState&)> condition_ = nullptr;
    std::function<void(GameState&)> effect_ = nullptr;
};

#endif // CHOICE_H
