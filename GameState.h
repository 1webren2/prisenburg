#ifndef GAMESTATE_H
#define GAMESTATE_H

#include <memory>
#include <string>
#include <unordered_map>

#include "Character.h"
#include "Scene.h"

// 游戏状态：场景表 + 变量表 + 角色表 + 当前所在场景
class GameState {
public:
    GameState() = default;

    // ---- 场景 ----
    void addScene(const std::shared_ptr<Scene>& scene);
    std::shared_ptr<Scene> getScene(const std::string& id) const;

    // ---- 数值变量（如 User_power）----
    void addVariable(const std::string& key, int value);  // 在原有基础上累加
    void setVariable(const std::string& key, int value);  // 直接赋值
    int getVariable(const std::string& key, int defaultValue = 0) const;

    // ---- 角色（如 Sibylla，好感度存在角色身上）----
    void addCharacter(const std::shared_ptr<Character>& character);
    std::shared_ptr<Character> getCharacter(const std::string& name) const;

    // ---- 当前场景 ----
    void setCurrentScene(const std::string& id);
    const std::string& currentSceneId() const { return currentSceneId_; }

private:
    std::unordered_map<std::string, int> variables_;
    std::unordered_map<std::string, std::shared_ptr<Scene>> scenes_;
    std::unordered_map<std::string, std::shared_ptr<Character>> characters_;
    std::string currentSceneId_;
};

#endif // GAMESTATE_H
